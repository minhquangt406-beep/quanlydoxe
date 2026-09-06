import os, math, hashlib, secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import jwt
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, status, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, DateTime, ForeignKey, func, Text
from sqlalchemy.orm import declarative_base, sessionmaker, Session

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/parking.db")
# Render/Postgres may provide postgres:// or postgresql://. SQLAlchemy with
# psycopg2 needs the explicit postgresql+psycopg2 driver.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql+psycopg2://" + DATABASE_URL[len("postgres://"): ]
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = "postgresql+psycopg2://" + DATABASE_URL[len("postgresql://"): ]
if DATABASE_URL.startswith("sqlite:///./") and not os.path.isabs(DATABASE_URL.replace("sqlite:///./", "")):
    db_path = BASE_DIR / DATABASE_URL.replace("sqlite:///./", "")
    db_path.parent.mkdir(parents=True, exist_ok=True)
    DATABASE_URL = f"sqlite:///{db_path}"

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")

# Parking timestamps are stored as naive local Vietnam time so the displayed
# check-in/check-out time matches the operator's clock on Render/Linux too.
def now_vn():
    return datetime.now(timezone(timedelta(hours=7))).replace(tzinfo=None)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()
security = HTTPBearer(auto_error=False)

app = FastAPI(title="Parking AI Pro", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    username = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="staff")
    full_name = Column(String(100), nullable=False, default="Nhân viên")

class Area(Base):
    __tablename__ = "areas"
    id = Column(Integer, primary_key=True)
    name = Column(String(100), unique=True, nullable=False)
    capacity = Column(Integer, nullable=False, default=20)

class ParkingSlot(Base):
    __tablename__ = "parking_slots"
    id = Column(Integer, primary_key=True)
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=False)
    name = Column(String(50), nullable=False)
    status = Column(String(20), nullable=False, default="empty")

class Vehicle(Base):
    __tablename__ = "vehicles"
    id = Column(Integer, primary_key=True)
    license_plate = Column(String(30), unique=True, nullable=False)
    vehicle_type = Column(String(30), nullable=False)

class CompanySetting(Base):
    __tablename__ = "company_settings"
    id = Column(Integer, primary_key=True)
    company_name = Column(String(150), nullable=False, default="Parking AI Pro")
    phone = Column(String(50), nullable=False, default="")
    address = Column(String(255), nullable=False, default="")

class Pricing(Base):
    __tablename__ = "pricing"
    id = Column(Integer, primary_key=True)
    vehicle_type = Column(String(30), unique=True, nullable=False)
    price_per_hour = Column(Float, nullable=False)

class Ticket(Base):
    __tablename__ = "tickets"
    id = Column(Integer, primary_key=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)
    ticket_type = Column(String(30), nullable=False, default="monthly")
    valid_until = Column(DateTime, nullable=True)
    active = Column(Boolean, nullable=False, default=True)

class ParkingRecord(Base):
    __tablename__ = "parking_records"
    id = Column(Integer, primary_key=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)
    slot_id = Column(Integer, ForeignKey("parking_slots.id"), nullable=False)
    time_in = Column(DateTime, nullable=False)
    time_out = Column(DateTime, nullable=True)
    fee = Column(Float, nullable=True)

class MonthlyPass(Base):
    __tablename__ = "monthly_passes"
    id = Column(Integer, primary_key=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)
    customer_name = Column(String(120), nullable=False, default="")
    phone = Column(String(40), nullable=False, default="")
    vehicle_type = Column(String(30), nullable=False)
    started_at = Column(DateTime, nullable=False, default=now_vn)
    expires_at = Column(DateTime, nullable=False)
    price = Column(Float, nullable=False, default=0)
    active = Column(Boolean, nullable=False, default=True)

class Payment(Base):
    __tablename__ = "payments"
    id = Column(Integer, primary_key=True)
    record_id = Column(Integer, ForeignKey("parking_records.id"), nullable=False, unique=True)
    method = Column(String(30), nullable=False, default="Tiền mặt")
    paid_at = Column(DateTime, nullable=False, default=now_vn)
    amount = Column(Float, nullable=False, default=0)

class RevenueReset(Base):
    __tablename__ = "revenue_resets"
    id = Column(Integer, primary_key=True)
    reset_at = Column(DateTime, nullable=False, default=now_vn)
    period_label = Column(String(20), nullable=False)
    amount_before = Column(Float, nullable=False, default=0)
    reset_by = Column(Integer, ForeignKey("users.id"), nullable=True)

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String(80), nullable=False)
    detail = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=now_vn)

Base.metadata.create_all(bind=engine)

def hash_password(password: str, salt: Optional[str] = None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return f"{salt}${digest}"

def verify_password(password: str, stored: str):
    try:
        salt, digest = stored.split("$", 1)
        return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex() == digest
    except Exception:
        return False

def token_for(user: User):
    payload = {"sub": str(user.id), "username": user.username, "role": user.role,
               "exp": datetime.now(timezone.utc) + timedelta(hours=12)}
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def current_user(credentials: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Chưa đăng nhập")
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=["HS256"])
        user = db.get(User, int(payload["sub"]))
        if not user:
            raise ValueError()
        return user
    except Exception:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập không hợp lệ")

def manager_only(user: User = Depends(current_user)):
    if user.role != "manager":
        raise HTTPException(status_code=403, detail="Chỉ Quản lý được sử dụng chức năng này")
    return user

def non_guest_user(user: User = Depends(current_user)):
    if user.role == "guest":
        raise HTTPException(status_code=403, detail="Tài khoản khách chỉ được xem tình trạng chỗ trống")
    return user

class LoginIn(BaseModel):
    username: str
    password: str

class VehicleIn(BaseModel):
    license_plate: str
    vehicle_type: str

class AreaIn(BaseModel):
    name: str
    capacity: int

class SlotIn(BaseModel):
    area_id: int
    name: str

class PriceIn(BaseModel):
    vehicle_type: str
    price_per_hour: float

class CheckIn(BaseModel):
    license_plate: str
    vehicle_type: str
    slot_id: Optional[int] = None

class CheckOut(BaseModel):
    record_id: int
    payment_method: str = "Tiền mặt"

class AIQuestion(BaseModel):
    question: str

class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "staff"
    full_name: str = "Nhân viên"

class PasswordChange(BaseModel):
    current_password: str
    new_password: str

class MonthlyPassIn(BaseModel):
    license_plate: str
    vehicle_type: str
    customer_name: str
    phone: str = ""
    months: int = 1
    price: float = 0

class CompanyIn(BaseModel):
    company_name: str
    phone: str = ""
    address: str = ""

def audit(db: Session, user: Optional[User], action: str, detail: str = ""):
    db.add(AuditLog(user_id=user.id if user else None, action=action, detail=detail[:1000], created_at=now_vn()))

def format_license_plate(plate: str) -> str:
    import re
    raw = str(plate or "").upper()
    p = re.sub(r"[^A-Z0-9]", "", raw)
    # Recover accidental duplicated first digit from older frontend formatter.
    if re.fullmatch(r"(\d)\1\d[A-Z]\d{5}", p):
        p = p[0] + p[2:]
    m = re.fullmatch(r"(\d{2})([A-Z](?:\d|[A-Z]))(\d{5})", p)
    if m:
        return f"{m.group(1)}{m.group(2)}-{m.group(3)[:3]}.{m.group(3)[3:]}"
    m = re.fullmatch(r"(\d{2})([A-Z])(\d{5})", p)
    if m:
        return f"{m.group(1)}{m.group(2)}-{m.group(3)[:3]}.{m.group(3)[3:]}"
    return raw.strip()

def infer_vehicle_type(plate: str) -> Optional[str]:
    import re
    p = re.sub(r"[^A-Z0-9]", "", str(plate or "").upper())
    # Xe máy: 29B1-123.45 / 29AD-123.45 và các mã tương tự.
    if re.fullmatch(r"\d{2}(?:[A-Z]\d|[A-Z]{2})\d{5}", p):
        return "Xe máy"
    # Ô tô: 29A-123.45 (sau chuẩn hóa thành 29A12345).
    if re.fullmatch(r"\d{2}[A-Z]\d{5}", p):
        return "Ô tô"
    return None

def seed():
    db = SessionLocal()
    try:
        if not db.query(User).filter(User.username == "guest").first():
            db.add(User(username="guest", password_hash=hash_password("guest12345"), role="guest", full_name="Khách xem bãi"))
            db.flush()
        if db.query(User).count() == 0:
            db.add_all([
                User(username="admin", password_hash=hash_password("Quang2005@@@@"), role="manager", full_name="Quản lý hệ thống"),
                User(username="staff", password_hash=hash_password("staff123"), role="staff", full_name="Nhân viên bãi xe"),
            ])
        if db.query(Area).count() == 0:
            a1, a2 = Area(name="Khu A", capacity=12), Area(name="Khu B", capacity=8)
            db.add_all([a1, a2]); db.flush()
            for i in range(1, 13): db.add(ParkingSlot(area_id=a1.id, name=f"A-{i:02d}", status="empty"))
            for i in range(1, 9): db.add(ParkingSlot(area_id=a2.id, name=f"B-{i:02d}", status="empty"))
        if db.query(Pricing).count() == 0:
            db.add_all([
                Pricing(vehicle_type="Xe đạp", price_per_hour=3000),
                Pricing(vehicle_type="Xe máy", price_per_hour=5000),
                Pricing(vehicle_type="Ô tô", price_per_hour=20000),
            ])
        db.commit()
    finally:
        db.close()

@app.post("/api/auth/login")
def login(data: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data.username.strip()).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Sai tài khoản hoặc mật khẩu")
    audit(db, user, "LOGIN", "Đăng nhập hệ thống")
    db.commit()
    return {"access_token": token_for(user), "token_type": "bearer", "user": {"id": user.id, "username": user.username, "role": user.role, "full_name": user.full_name}}

@app.get("/api/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "username": user.username, "role": user.role, "full_name": user.full_name}

class GuestRegisterIn(BaseModel):
    username: str
    password: str
    full_name: str

@app.post("/api/auth/register")
def register_guest(data: GuestRegisterIn, db: Session = Depends(get_db)):
    username = data.username.strip()
    full_name = data.full_name.strip()
    if len(username) < 4 or len(username) > 50:
        raise HTTPException(400, "Tài khoản phải từ 4 đến 50 ký tự")
    if len(data.password) < 8:
        raise HTTPException(400, "Mật khẩu phải có ít nhất 8 ký tự")
    if len(full_name) < 2:
        raise HTTPException(400, "Vui lòng nhập họ tên")
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(409, "Tài khoản đã tồn tại")
    user = User(username=username, password_hash=hash_password(data.password), role="guest", full_name=full_name)
    db.add(user); db.flush()
    audit(db, user, "REGISTER_GUEST", "Khách tự đăng ký tài khoản chỉ xem chỗ trống")
    db.commit()
    return {"message": "Đăng ký thành công. Bạn có thể đăng nhập để xem tình trạng chỗ trống.", "role": "guest"}

seed()


def ensure_monthly_revenue_period(db: Session):
    """Create an automatic monthly reset marker on the first access of a new month.
    Payment/parking history is never deleted; only the current revenue counter starts at 0.
    """
    now = now_vn()
    month_label = now.strftime("%Y-%m")
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    exists = db.query(RevenueReset).filter(RevenueReset.period_label == month_label).first()
    if not exists:
        # Archive the previous month's revenue before starting the new counter.
        prev_amount = db.query(func.coalesce(func.sum(ParkingRecord.fee), 0)).filter(
            ParkingRecord.time_out.is_not(None),
            ParkingRecord.time_out >= month_start
        ).scalar() or 0
        # This marker is the start of the current month, so amount_before is informational.
        db.add(RevenueReset(reset_at=month_start, period_label=month_label, amount_before=0, reset_by=None))
        db.commit()
    return db.query(RevenueReset).filter(RevenueReset.period_label == month_label).first()

def current_revenue(db: Session):
    ensure_monthly_revenue_period(db)
    now = now_vn()
    month_label = now.strftime("%Y-%m")
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    # The latest reset marker wins. On a new month the monthly marker automatically
    # becomes the starting point; a manual reset can start a fresh counter mid-month.
    marker = db.query(RevenueReset).filter(RevenueReset.reset_at >= month_start).order_by(RevenueReset.reset_at.desc()).first()
    if not marker:
        marker = db.query(RevenueReset).filter(RevenueReset.period_label == month_label).first()
    total = db.query(func.coalesce(func.sum(ParkingRecord.fee), 0)).filter(
        ParkingRecord.time_out.is_not(None), ParkingRecord.time_out >= marker.reset_at
    ).scalar() or 0
    return float(total), marker

@app.get("/api/revenue")
def revenue_summary(db: Session = Depends(get_db), user: User = Depends(non_guest_user)):
    total, marker = current_revenue(db)
    month_start = marker.reset_at
    return {"current_revenue": total, "period": marker.period_label, "reset_at": month_start.isoformat()}

@app.post("/api/revenue/reset")
def revenue_reset(db: Session = Depends(get_db), user: User = Depends(manager_only)):
    now = now_vn()
    total, marker = current_revenue(db)
    # Keep a permanent snapshot, then start a fresh counter immediately.
    snapshot = RevenueReset(reset_at=now, period_label=f"RESET-{now.strftime('%Y-%m-%d %H:%M')}", amount_before=total, reset_by=user.id)
    db.add(snapshot)
    audit(db, user, "RESET_REVENUE", f"Reset doanh thu {total:.0f} VNĐ")
    db.commit()
    return {"message": "Đã reset số tiền doanh thu hiện tại", "current_revenue": 0, "reset_at": now.isoformat()}

@app.get("/api/revenue/history")
def revenue_history(db: Session = Depends(get_db), user: User = Depends(manager_only)):
    ensure_monthly_revenue_period(db)
    rows = db.query(RevenueReset).order_by(RevenueReset.reset_at.desc()).all()
    out=[]
    now = now_vn()
    for r in rows:
        if r.period_label.startswith("RESET-"):
            label = "Reset thủ công · " + r.reset_at.strftime("%d/%m/%Y %H:%M")
            amount = float(r.amount_before or 0)
        else:
            label = "Tháng " + r.period_label
            start_month = r.reset_at
            if r.period_label == now.strftime("%Y-%m"):
                end_month = now
            else:
                y, m = map(int, r.period_label.split("-"))
                if m == 12:
                    end_month = datetime(y + 1, 1, 1)
                else:
                    end_month = datetime(y, m + 1, 1)
            amount = db.query(func.coalesce(func.sum(ParkingRecord.fee), 0)).filter(
                ParkingRecord.time_out.is_not(None),
                ParkingRecord.time_out >= start_month,
                ParkingRecord.time_out < end_month
            ).scalar() or 0
            amount = float(amount)
        out.append({"id": r.id, "period": label, "reset_at": r.reset_at.isoformat(), "amount": amount})
    return out

@app.get("/api/reports")
def reports(days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db), user: User = Depends(manager_only)):
    since = now_vn() - timedelta(days=days-1)
    rows = db.query(ParkingRecord, Vehicle, ParkingSlot).join(Vehicle, ParkingRecord.vehicle_id == Vehicle.id).join(ParkingSlot, ParkingRecord.slot_id == ParkingSlot.id).filter(ParkingRecord.time_out.is_not(None), ParkingRecord.time_out >= since).all()
    daily, by_area, total = {}, {}, 0.0
    for r,v,s in rows:
        key = r.time_out.strftime("%Y-%m-%d")
        daily[key] = daily.get(key, 0.0) + float(r.fee or 0)
        area = db.get(Area, s.area_id); name = area.name if area else "Không xác định"
        by_area[name] = by_area.get(name, 0.0) + float(r.fee or 0); total += float(r.fee or 0)
    return {"days": days, "total_revenue": total, "closed_records": len(rows), "daily": daily, "by_area": by_area}

@app.get("/api/backup")
def backup(db: Session = Depends(get_db), user: User = Depends(manager_only)):
    if not DATABASE_URL.startswith("sqlite"):
        raise HTTPException(400, "Chức năng tải backup file hiện dành cho SQLite")
    db_file = DATABASE_URL.replace("sqlite:///", "")
    path = Path(db_file)
    if not path.exists():
        raise HTTPException(404, "Chưa có file database để sao lưu")
    return FileResponse(path, media_type="application/octet-stream", filename=f"parking-backup-{now_vn().strftime('%Y%m%d-%H%M%S')}.db")

@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db), user: User = Depends(current_user)):
    total = db.query(ParkingSlot).count()
    occupied = db.query(ParkingSlot).filter(ParkingSlot.status == "occupied").count()
    empty = total - occupied
    active = db.query(ParkingRecord).filter(ParkingRecord.time_out.is_(None)).count()
    revenue, _rev_marker = current_revenue(db)
    closed = db.query(ParkingRecord).filter(ParkingRecord.time_out.is_not(None)).count()
    peak = None
    rows = db.query(ParkingRecord.time_in).all()
    if rows:
        counts = {}
        for (dt,) in rows:
            h = dt.hour
            counts[h] = counts.get(h, 0) + 1
        if counts:
            h = max(counts, key=counts.get)
            peak = f"{h:02d}:00–{(h+1)%24:02d}:00"
    return {"total_slots": total, "occupied": occupied, "empty": empty,
            "active_vehicles": active, "revenue": float(revenue), "closed_records": closed,
            "occupancy_rate": round((occupied / total * 100) if total else 0, 1),
            "peak_hour": peak or "Chưa đủ dữ liệu"}

@app.get("/api/areas")
def areas(db: Session = Depends(get_db), user: User = Depends(current_user)):
    out = []
    for a in db.query(Area).order_by(Area.id).all():
        occupied = db.query(ParkingSlot).filter(ParkingSlot.area_id == a.id, ParkingSlot.status == "occupied").count()
        out.append({"id": a.id, "name": a.name, "capacity": a.capacity, "occupied": occupied, "empty": a.capacity-occupied})
    return out

@app.post("/api/areas")
def add_area(data: AreaIn, db: Session = Depends(get_db), user: User = Depends(manager_only)):
    a = Area(name=data.name.strip(), capacity=data.capacity)
    db.add(a); db.flush()
    audit(db, user, "CREATE_AREA", f"Tạo {a.name} ({a.capacity} vị trí)")
    for i in range(1, data.capacity + 1):
        db.add(ParkingSlot(area_id=a.id, name=f"{data.name}-{i:02d}", status="empty"))
    db.commit()
    return {"message": "Đã tạo khu vực", "id": a.id}

@app.delete("/api/areas/{area_id}")
def delete_area(area_id: int, db: Session = Depends(get_db), user: User = Depends(manager_only)):
    area = db.get(Area, area_id)
    if not area:
        raise HTTPException(404, "Khu vực không tồn tại")

    slots_in_area = db.query(ParkingSlot).filter(ParkingSlot.area_id == area_id).all()
    slot_ids = [s.id for s in slots_in_area]

    occupied = [s for s in slots_in_area if s.status == "occupied"]
    if occupied:
        raise HTTPException(409, "Không thể xóa khu đang có xe. Hãy cho xe ra trước.")

    # Keep historical parking records intact. A used slot cannot be deleted because
    # its history points to it via ParkingRecord.slot_id.
    if slot_ids:
        historical = db.query(ParkingRecord).filter(ParkingRecord.slot_id.in_(slot_ids)).first()
        if historical:
            raise HTTPException(409, "Khu này đã có lịch sử gửi xe nên không thể xóa để tránh mất dữ liệu. Có thể đổi tên khu thay thế.")

    for slot in slots_in_area:
        db.delete(slot)
    audit(db, user, "DELETE_AREA", f"Xóa {area.name}")
    db.delete(area)
    db.commit()
    return {"message": f"Đã xóa {area.name}"}

@app.get("/api/slots")
def slots(db: Session = Depends(get_db), user: User = Depends(non_guest_user)):
    areas_map = {a.id: a.name for a in db.query(Area).all()}
    active_rows = (db.query(ParkingRecord.slot_id, Vehicle.license_plate, Vehicle.vehicle_type, ParkingRecord.time_in)
                   .join(Vehicle, ParkingRecord.vehicle_id == Vehicle.id)
                   .filter(ParkingRecord.time_out.is_(None)).all())
    active_map = {row[0]: {"license_plate": (None if row[2] == "Xe đạp" else row[1]), "vehicle_type": row[2], "time_in": row[3].isoformat()} for row in active_rows}
    return [{"id": s.id, "area_id": s.area_id, "area_name": areas_map.get(s.area_id, ""),
             "name": s.name, "status": s.status, **active_map.get(s.id, {})}
            for s in db.query(ParkingSlot).order_by(ParkingSlot.area_id, ParkingSlot.id).all()]

@app.post("/api/slots")
def add_slot(data: SlotIn, db: Session = Depends(get_db), user: User = Depends(manager_only)):
    if not db.get(Area, data.area_id): raise HTTPException(404, "Khu vực không tồn tại")
    s = ParkingSlot(area_id=data.area_id, name=data.name, status="empty")
    db.add(s); db.commit()
    return {"message": "Đã tạo vị trí", "id": s.id}

@app.get("/api/pricing")
def pricing(db: Session = Depends(get_db), user: User = Depends(non_guest_user)):
    return [{"id": p.id, "vehicle_type": p.vehicle_type, "price_per_hour": p.price_per_hour}
            for p in db.query(Pricing).order_by(Pricing.id).all()]

@app.post("/api/pricing")
def add_price(data: PriceIn, db: Session = Depends(get_db), user: User = Depends(manager_only)):
    p = db.query(Pricing).filter(Pricing.vehicle_type == data.vehicle_type).first()
    if p: p.price_per_hour = data.price_per_hour
    else: db.add(Pricing(vehicle_type=data.vehicle_type, price_per_hour=data.price_per_hour))
    audit(db, user, "UPDATE_PRICING", f"{data.vehicle_type}: {data.price_per_hour:,.0f} VNĐ/giờ")
    db.commit()
    return {"message": "Đã lưu bảng giá"}

@app.get("/api/vehicles")
def vehicles(db: Session = Depends(get_db), user: User = Depends(non_guest_user)):
    return [{"id": v.id, "license_plate": (None if v.vehicle_type == "Xe đạp" else v.license_plate), "vehicle_type": v.vehicle_type}
            for v in db.query(Vehicle).order_by(Vehicle.id.desc()).all()]

@app.post("/api/checkin")
def checkin(data: CheckIn, db: Session = Depends(get_db), user: User = Depends(non_guest_user)):
    # Xe đạp không có biển số. Hệ thống chỉ tạo mã nội bộ để quản lý dữ liệu;
    # mã này không được hiển thị như biển số trên giao diện.
    requested_type = data.vehicle_type if data.vehicle_type in ("Xe máy", "Ô tô", "Xe đạp") else "Xe máy"
    raw_plate = str(data.license_plate or "").strip()
    if requested_type == "Xe đạp":
        plate = ""
        vehicle_type = "Xe đạp"
    else:
        plate = format_license_plate(raw_plate)
        if not plate:
            raise HTTPException(400, "Vui lòng nhập biển số xe")
        detected_type = infer_vehicle_type(plate)
        vehicle_type = detected_type or requested_type

    active_vehicle_ids = [x[0] for x in db.query(ParkingRecord.vehicle_id).filter(ParkingRecord.time_out.is_(None)).all()]
    existing = None if vehicle_type == "Xe đạp" else db.query(Vehicle).filter(Vehicle.license_plate == plate).first()
    if existing and existing.id in active_vehicle_ids:
        raise HTTPException(409, "Xe đang tồn tại trong bãi")
    slot = db.get(ParkingSlot, data.slot_id) if data.slot_id else None
    if data.slot_id and (not slot or slot.status != "empty"):
        raise HTTPException(409, "Vị trí không còn trống")
    if slot is None:
        slot = db.query(ParkingSlot).filter(ParkingSlot.status == "empty").order_by(ParkingSlot.area_id, ParkingSlot.id).first()
        if not slot:
            raise HTTPException(409, "Bãi đã đầy, không còn vị trí trống")
    if not existing:
        internal_plate = plate or f"XE-DAP-{secrets.token_hex(5).upper()}"
        existing = Vehicle(license_plate=internal_plate, vehicle_type=vehicle_type)
        db.add(existing); db.flush()
    else:
        existing.vehicle_type = vehicle_type
    record = ParkingRecord(vehicle_id=existing.id, slot_id=slot.id, time_in=now_vn())
    slot.status = "occupied"
    db.add(record)
    audit_label = "Xe đạp (không biển số)" if vehicle_type == "Xe đạp" else f"{plate} ({vehicle_type})"
    audit(db, user, "CHECKIN", f"{audit_label} → {slot.name}")
    db.commit(); db.refresh(record)
    return {"message": "Cho xe vào thành công", "record_id": record.id, "time_in": record.time_in.isoformat(), "slot": slot.name, "vehicle_type": vehicle_type, "license_plate": None if vehicle_type == "Xe đạp" else plate}

def calculate_fee(db: Session, record: ParkingRecord, time_out: datetime):
    vehicle = db.get(Vehicle, record.vehicle_id)
    price = db.query(Pricing).filter(Pricing.vehicle_type == vehicle.vehicle_type).first()
    if not price: raise HTTPException(400, "Chưa có bảng giá cho loại xe")
    total_seconds = max(0, (time_out - record.time_in).total_seconds())
    billable_hours = total_seconds / 3600.0
    fee = billable_hours * float(price.price_per_hour)
    return billable_hours, round(fee)

@app.get("/api/checkout-preview/{record_id}")
def checkout_preview(record_id: int, db: Session = Depends(get_db), user: User = Depends(non_guest_user)):
    record = db.get(ParkingRecord, record_id)
    if not record or record.time_out is not None:
        raise HTTPException(404, "Lượt gửi không hợp lệ hoặc đã kết thúc")
    vehicle = db.get(Vehicle, record.vehicle_id)
    slot = db.get(ParkingSlot, record.slot_id)
    time_out = now_vn()
    hours, fee = calculate_fee(db, record, time_out)
    parked_minutes = max(0, int((time_out - record.time_in).total_seconds() // 60))
    parked_hours = parked_minutes // 60
    parked_mins = parked_minutes % 60
    duration_text = f"{parked_hours} giờ {parked_mins} phút" if parked_hours else f"{parked_mins} phút"
    price = db.query(Pricing).filter(Pricing.vehicle_type == (vehicle.vehicle_type if vehicle else "")).first()
    price_per_hour = float(price.price_per_hour) if price else 0
    vehicle_type = vehicle.vehicle_type if vehicle else ""
    # Xe đạp không có biển số, nên dùng nội dung chuyển khoản riêng và duy nhất theo mã lượt.
    transfer_content = f"VE-XEDAP-{record.id}" if vehicle_type == "Xe đạp" else f"VE-{(vehicle.license_plate if vehicle else '')}"
    return {
        "record_id": record.id,
        "license_plate": vehicle.license_plate if vehicle and vehicle_type != "Xe đạp" else "",
        "vehicle_type": vehicle_type,
        "slot": slot.name if slot else "",
        "transfer_content": transfer_content,
        "hours": round(hours, 4),
        "billable_hours": round(hours, 4),
        "parked_minutes": parked_minutes,
        "duration_text": duration_text,
        "price_per_hour": price_per_hour,
        "fee": fee,
        "billing_text": f"{hours:.2f} giờ × {price_per_hour:,.0f} VNĐ/giờ = {fee:,.0f} VNĐ"
    }

@app.post("/api/checkout")
def checkout(data: CheckOut, db: Session = Depends(get_db), user: User = Depends(non_guest_user)):
    record = db.get(ParkingRecord, data.record_id)
    if not record or record.time_out is not None:
        raise HTTPException(404, "Lượt gửi không hợp lệ hoặc đã kết thúc")
    time_out = now_vn()
    hours, fee = calculate_fee(db, record, time_out)
    method = data.payment_method if data.payment_method in ("Tiền mặt","Chuyển khoản","QR ngân hàng","Miễn phí") else "Tiền mặt"
    # Lượt miễn phí luôn có tổng tiền bằng 0, không thu phí.
    if method == "Miễn phí":
        fee = 0
    record.time_out, record.fee = time_out, fee
    slot = db.get(ParkingSlot, record.slot_id)
    if slot: slot.status = "empty"
    vehicle = db.get(Vehicle, record.vehicle_id)
    db.add(Payment(record_id=record.id, method=method, paid_at=now_vn(), amount=fee))
    audit(db, user, "CHECKOUT", f"{vehicle.license_plate if vehicle else record.vehicle_id} → {fee:,.0f} VNĐ · {method}")
    db.commit()
    return {"message": "Cho xe ra thành công", "record_id": record.id, "hours": hours, "fee": fee, "time_out": time_out.isoformat(), "payment_method": method}

@app.get("/api/receipt/{record_id}")
def receipt(record_id: int, db: Session = Depends(get_db), user: User = Depends(non_guest_user)):
    row = db.query(ParkingRecord, Vehicle, ParkingSlot).join(Vehicle, ParkingRecord.vehicle_id == Vehicle.id).join(ParkingSlot, ParkingRecord.slot_id == ParkingSlot.id).filter(ParkingRecord.id == record_id).first()
    if not row:
        raise HTTPException(404, "Không tìm thấy hóa đơn")
    r,v,s = row; area = db.get(Area, s.area_id); company = db.query(CompanySetting).first()
    company_name = company.company_name if company else "Parking AI Pro"; phone = company.phone if company else ""; address = company.address if company else ""
    html = f"""<!doctype html><html lang='vi'><head><meta charset='utf-8'><title>Biên lai #{r.id}</title><style>body{{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;padding:24px;color:#111}}.head{{text-align:center;border-bottom:2px solid #111;padding-bottom:16px}}table{{width:100%;border-collapse:collapse;margin-top:20px}}td{{padding:10px;border-bottom:1px solid #ddd}}.total{{font-size:24px;font-weight:700;text-align:right;margin-top:20px}}button{{padding:12px 18px;border:0;border-radius:8px;background:#111;color:white;cursor:pointer}}@media print{{button{{display:none}}body{{margin:0}}}}</style></head><body><div class='head'><h1>{company_name}</h1><div>{address}</div><div>{phone}</div><h2>BIÊN LAI GỬI XE</h2><div>Mã lượt #{r.id}</div></div><table><tr><td>Biển số</td><td><b>{v.license_plate}</b></td></tr><tr><td>Loại xe</td><td>{v.vehicle_type}</td></tr><tr><td>Khu vực</td><td>{area.name if area else '—'} · {s.name}</td></tr><tr><td>Thời gian vào</td><td>{r.time_in.strftime('%d/%m/%Y %H:%M')}</td></tr><tr><td>Thời gian ra</td><td>{r.time_out.strftime('%d/%m/%Y %H:%M') if r.time_out else '—'}</td></tr></table><div class='total'>Tổng tiền: {float(r.fee or 0):,.0f} VNĐ</div><p style='text-align:center;margin-top:30px'>Cảm ơn quý khách!</p><div style='text-align:center'><button onclick='window.print()'>In biên lai</button></div></body></html>"""
    return HTMLResponse(html)

@app.get("/api/active")
def active(db: Session = Depends(get_db), user: User = Depends(non_guest_user)):
    q = db.query(ParkingRecord, Vehicle, ParkingSlot).join(Vehicle, ParkingRecord.vehicle_id == Vehicle.id).join(ParkingSlot, ParkingRecord.slot_id == ParkingSlot.id).filter(ParkingRecord.time_out.is_(None)).order_by(ParkingRecord.time_in.desc()).all()
    return [{"id": r.id, "license_plate": (None if v.vehicle_type == "Xe đạp" else v.license_plate), "vehicle_type": v.vehicle_type,
             "slot": s.name, "time_in": r.time_in.isoformat()} for r,v,s in q]

@app.delete("/api/history/{record_id}")
def delete_history(record_id: int, db: Session = Depends(get_db), user: User = Depends(manager_only)):
    record = db.get(ParkingRecord, record_id)
    if not record:
        raise HTTPException(404, "Lượt gửi không tồn tại")
    # Nếu lượt này vẫn đang hoạt động, trả ô đỗ về trạng thái trống trước khi xóa.
    if record.time_out is None:
        slot = db.get(ParkingSlot, record.slot_id)
        if slot:
            slot.status = "empty"
    audit(db, user, "DELETE_HISTORY", f"Xóa lượt #{record_id}")
    db.delete(record)
    db.commit()
    return {"message": f"Đã xóa lượt #{record_id} khỏi lịch sử"}

@app.delete("/api/vehicles/{vehicle_id}")
def delete_vehicle(vehicle_id: int, db: Session = Depends(get_db), user: User = Depends(manager_only)):
    vehicle = db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise HTTPException(404, "Phương tiện không tồn tại")
    active = db.query(ParkingRecord).filter(ParkingRecord.vehicle_id == vehicle_id, ParkingRecord.time_out.is_(None)).first()
    if active:
        raise HTTPException(409, "Không thể xóa xe đang ở trong bãi. Hãy cho xe ra trước.")
    has_history = db.query(ParkingRecord).filter(ParkingRecord.vehicle_id == vehicle_id).first()
    if has_history:
        raise HTTPException(409, "Xe đã có lịch sử gửi xe. Không xóa để bảo toàn dữ liệu; chỉ có thể xóa xe chưa phát sinh lịch sử.")
    db.query(Ticket).filter(Ticket.vehicle_id == vehicle_id).delete(synchronize_session=False)
    plate = vehicle.license_plate
    db.delete(vehicle)
    audit(db, user, "DELETE_VEHICLE", f"Xóa phương tiện {plate}")
    db.commit()
    return {"message": f"Đã xóa xe {plate}"}

@app.get("/api/history")
def history(db: Session = Depends(get_db), user: User = Depends(non_guest_user), q: str = Query("", max_length=100)):
    rows = db.query(ParkingRecord, Vehicle, ParkingSlot).join(Vehicle, ParkingRecord.vehicle_id == Vehicle.id).join(ParkingSlot, ParkingRecord.slot_id == ParkingSlot.id).order_by(ParkingRecord.id.desc()).limit(500).all()
    result = []
    for r,v,s in rows:
        text = f"{r.id} {v.license_plate} {v.vehicle_type} {s.name}".lower()
        if q.lower() not in text: continue
        payment = db.query(Payment).filter(Payment.record_id == r.id).first()
        result.append({"id": r.id, "license_plate": (None if v.vehicle_type == "Xe đạp" else v.license_plate), "vehicle_type": v.vehicle_type,
                       "slot": s.name, "time_in": r.time_in.isoformat(),
                       "time_out": r.time_out.isoformat() if r.time_out else None, "fee": r.fee,
                       "payment_method": payment.method if payment else ("Miễn phí" if float(r.fee or 0) == 0 else "Chưa thanh toán"),
                       "paid_at": payment.paid_at.isoformat() if payment else None})
    return result

@app.get("/api/auto-slot")
def auto_slot(vehicle_type: str = Query("Xe máy"), db: Session = Depends(get_db), user: User = Depends(non_guest_user)):
    slot = db.query(ParkingSlot).filter(ParkingSlot.status == "empty").order_by(ParkingSlot.area_id, ParkingSlot.id).first()
    if not slot: raise HTTPException(409, "Bãi đã đầy")
    area = db.get(Area, slot.area_id)
    return {"slot_id": slot.id, "slot": slot.name, "area": area.name if area else "", "vehicle_type": vehicle_type}

@app.get("/api/monthly")
def monthly(db: Session = Depends(get_db), user: User = Depends(non_guest_user)):
    rows=db.query(MonthlyPass).order_by(MonthlyPass.expires_at.asc()).all(); out=[]
    for x in rows:
        v=db.get(Vehicle,x.vehicle_id)
        out.append({"id":x.id,"license_plate":v.license_plate if v else "","vehicle_type":x.vehicle_type,"customer_name":x.customer_name,"phone":x.phone,"started_at":x.started_at.isoformat(),"expires_at":x.expires_at.isoformat(),"price":x.price,"active":x.active,"expired":x.expires_at < now_vn()})
    return out

@app.post("/api/monthly")
def create_monthly(data: MonthlyPassIn, db: Session = Depends(get_db), user: User = Depends(manager_only)):
    months=max(1,min(12,data.months)); plate=format_license_plate(data.license_plate)
    v=db.query(Vehicle).filter(Vehicle.license_plate==plate).first()
    if not v: v=Vehicle(license_plate=plate,vehicle_type=data.vehicle_type); db.add(v); db.flush()
    else: v.vehicle_type=data.vehicle_type
    start=now_vn(); expiry=start+timedelta(days=30*months)
    row=MonthlyPass(vehicle_id=v.id,customer_name=data.customer_name.strip(),phone=data.phone.strip(),vehicle_type=data.vehicle_type,started_at=start,expires_at=expiry,price=data.price*months,active=True)
    db.add(row); audit(db,user,"CREATE_MONTHLY_PASS",f"Tạo vé tháng {plate}, hết hạn {expiry:%d/%m/%Y}"); db.commit(); db.refresh(row)
    return {"message":"Đã tạo vé tháng","id":row.id,"expires_at":expiry.isoformat()}

@app.get("/api/ticket/qr/{record_id}")
def ticket_qr(record_id:int, db:Session=Depends(get_db), user:User=Depends(current_user)):
    r=db.get(ParkingRecord,record_id)
    if not r: raise HTTPException(404,"Không tìm thấy lượt gửi")
    v=db.get(Vehicle,r.vehicle_id); s=db.get(ParkingSlot,r.slot_id); a=db.get(Area,s.area_id) if s else None
    import base64,io
    try:
        import qrcode
        payload=f"PARKING|{r.id}|{v.license_plate}|{s.name if s else ''}|{r.time_in.isoformat()}"
        img=qrcode.make(payload); buf=io.BytesIO(); img.save(buf,format="PNG")
        return {"record_id":r.id,"license_plate":v.license_plate,"slot":s.name if s else "","area":a.name if a else "","time_in":r.time_in.isoformat(),"qr_data":"data:image/png;base64,"+base64.b64encode(buf.getvalue()).decode()}
    except ImportError:
        return {"record_id":r.id,"license_plate":v.license_plate,"slot":s.name if s else "","area":a.name if a else "","time_in":r.time_in.isoformat(),"qr_data":None,"qr_text":f"PARKING|{r.id}|{v.license_plate}"}

@app.get("/api/export/history.csv")
def export_history(db:Session=Depends(get_db), user:User=Depends(manager_only)):
    import csv,io
    rows=db.query(ParkingRecord,Vehicle,ParkingSlot).join(Vehicle,ParkingRecord.vehicle_id==Vehicle.id).join(ParkingSlot,ParkingRecord.slot_id==ParkingSlot.id).order_by(ParkingRecord.id.desc()).all()
    buf=io.StringIO(); w=csv.writer(buf); w.writerow(["Ma","Bien so","Loai xe","Vi tri","Thoi gian vao","Thoi gian ra","Phi"])
    for r,v,s in rows: w.writerow([r.id,v.license_plate,v.vehicle_type,s.name,r.time_in,r.time_out or "",r.fee or 0])
    return StreamingResponse(iter([buf.getvalue().encode("utf-8-sig")]),media_type="text/csv; charset=utf-8",headers={"Content-Disposition":f'attachment; filename="parking-history-{now_vn():%Y%m%d-%H%M%S}.csv"'})

@app.get("/api/ai/prediction")
def ai_prediction(db:Session=Depends(get_db), user:User=Depends(manager_only)):
    total=db.query(ParkingSlot).count(); occupied=db.query(ParkingSlot).filter(ParkingSlot.status=="occupied").count(); rate=(occupied/total*100 if total else 0)
    rows=db.query(ParkingRecord.time_in).filter(ParkingRecord.time_in >= now_vn()-timedelta(days=7)).all(); counts={}
    for (dtv,) in rows: counts[dtv.hour]=counts.get(dtv.hour,0)+1
    peak=max(counts,key=counts.get) if counts else None; projected=min(100,round(rate+(12 if peak is not None and abs(now_vn().hour-peak)<=2 else 4),1))
    return {"occupancy_rate":round(rate,1),"peak_hour":f"{peak:02d}:00–{(peak+1)%24:02d}:00" if peak is not None else "Chưa đủ dữ liệu","projected_peak_occupancy":projected,"risk":"Cao" if projected>=90 else "Trung bình" if projected>=70 else "Thấp","recommendation":"Chuẩn bị điều hướng sang khu còn nhiều chỗ và tăng nhân sự tại giờ cao điểm." if projected>=70 else "Bãi đang ổn định; duy trì phân bổ hiện tại."}

@app.get("/api/activity")
def activity(limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_db), user: User = Depends(non_guest_user)):
    rows = db.query(AuditLog, User).outerjoin(User, AuditLog.user_id == User.id).order_by(AuditLog.id.desc()).limit(limit).all()
    return [{"id": a.id, "username": u.username if u else "system", "action": a.action, "detail": a.detail, "created_at": a.created_at.isoformat()} for a,u in rows]

@app.get("/api/analytics")
def analytics(db: Session = Depends(get_db), user: User = Depends(non_guest_user)):
    today = now_vn().date()
    start = datetime.combine(today, datetime.min.time())
    end = start + timedelta(days=1)
    ins = db.query(ParkingRecord).filter(ParkingRecord.time_in >= start, ParkingRecord.time_in < end).count()
    outs = db.query(ParkingRecord).filter(ParkingRecord.time_out >= start, ParkingRecord.time_out < end).count()
    revenue = db.query(func.coalesce(func.sum(ParkingRecord.fee), 0)).filter(ParkingRecord.time_out >= start, ParkingRecord.time_out < end).scalar() or 0
    types = {}
    for (typ, count) in db.query(Vehicle.vehicle_type, func.count(ParkingRecord.id)).join(ParkingRecord, ParkingRecord.vehicle_id == Vehicle.id).group_by(Vehicle.vehicle_type).all(): types[typ] = count
    return {"today_checkins": ins, "today_checkouts": outs, "today_revenue": float(revenue), "vehicle_types": types}

def local_ai(db: Session, question: str):
    """Answer the user's specific parking question instead of returning a generic dashboard summary."""
    q = (question or "").strip().lower()
    total_slots = db.query(ParkingSlot).count()
    occupied = db.query(ParkingSlot).filter(ParkingSlot.status == "occupied").count()
    empty = max(total_slots - occupied, 0)
    revenue = db.query(func.coalesce(func.sum(ParkingRecord.fee), 0)).scalar() or 0
    active = db.query(ParkingRecord).filter(ParkingRecord.time_out.is_(None)).count()
    rows = db.query(ParkingRecord.time_in, ParkingRecord.time_out, ParkingRecord.fee).all()

    counts = {}
    for time_in, _, _ in rows:
        counts[time_in.hour] = counts.get(time_in.hour, 0) + 1
    peak = max(counts, key=counts.get) if counts else None
    peak_text = f"{peak:02d}:00–{(peak+1)%24:02d}:00" if peak is not None else "chưa xác định"

    # Match the question first. Only return the requested metric.
    if any(k in q for k in ["trống", "còn bao nhiêu chỗ", "còn chỗ", "vị trí trống"]):
        return f"Hiện còn {empty} vị trí trống trên tổng {total_slots} vị trí."
    if any(k in q for k in ["đang gửi", "đang trong bãi", "trong bãi", "xe hiện tại", "xe đang đỗ"]):
        return f"Hiện có {active} xe đang gửi trong bãi."
    if any(k in q for k in ["lấp đầy", "tỷ lệ sử dụng", "chiếm bao nhiêu phần trăm"]):
        rate = occupied / total_slots * 100 if total_slots else 0
        return f"Tỷ lệ lấp đầy hiện tại là {rate:.1f}% ({occupied}/{total_slots} vị trí)."
    if any(k in q for k in ["doanh thu", "thu được", "tiền thu"]):
        return f"Doanh thu đã ghi nhận là {float(revenue):,.0f} VNĐ."
    if any(k in q for k in ["cao điểm", "đông nhất", "nhiều xe nhất", "giờ nào đông"]):
        return f"Khung giờ có nhiều lượt vào nhất là {peak_text} ({counts.get(peak, 0)} lượt)." if peak is not None else "Chưa đủ dữ liệu để xác định giờ cao điểm."
    if any(k in q for k in ["check in", "check-in", "xe vào", "lượt vào"]):
        return f"Có {len([r for r in rows if r[0] is not None])} lượt xe vào trong dữ liệu hiện có."
    if any(k in q for k in ["check out", "check-out", "xe ra", "lượt ra"]):
        return f"Có {len([r for r in rows if r[1] is not None])} lượt xe đã ra trong dữ liệu hiện có."
    if any(k in q for k in ["trạng thái", "tình hình", "tổng quan"]):
        rate = occupied / total_slots * 100 if total_slots else 0
        return f"Bãi hiện có {active} xe đang gửi, {empty} chỗ trống và tỷ lệ lấp đầy {rate:.1f}%."

    return ("Mình chưa xác định được chỉ số bạn muốn hỏi. Bạn có thể hỏi cụ thể như: "
            "‘Còn bao nhiêu chỗ trống?’, ‘Hiện có bao nhiêu xe đang gửi?’, "
            "‘Doanh thu là bao nhiêu?’, hoặc ‘Giờ nào đông nhất?’")

@app.post("/api/ai")
def ai(data: AIQuestion, db: Session = Depends(get_db), user: User = Depends(manager_only)):
    if not data.question.strip(): raise HTTPException(400, "Vui lòng nhập câu hỏi")
    if not DEEPSEEK_API_KEY:
        return {"answer": local_ai(db, data.question), "mode": "local", "provider": "local"}
    try:
        from openai import OpenAI
        total = db.query(ParkingSlot).count()
        occupied = db.query(ParkingSlot).filter(ParkingSlot.status == "occupied").count()
        revenue = db.query(func.coalesce(func.sum(ParkingRecord.fee), 0)).scalar() or 0
        rows = db.query(ParkingRecord.time_in).all()
        hourly = {}
        for (dt,) in rows: hourly[dt.hour] = hourly.get(dt.hour, 0) + 1
        client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=DEEPSEEK_BASE_URL)
        active = db.query(ParkingRecord).filter(ParkingRecord.time_out.is_(None)).count()
        empty = max(total - occupied, 0)
        prompt = f"""Bạn là trợ lý AI cho hệ thống quản lý bãi đỗ xe.
QUY TẮC BẮT BUỘC:
1. Trả lời ĐÚNG trọng tâm câu hỏi, không tự động đưa ra bản tổng quan nếu người dùng chỉ hỏi một chỉ số.
2. Chỉ dùng số liệu trong dữ liệu được cung cấp; không bịa hoặc suy đoán.
3. Trả lời bằng tiếng Việt, ưu tiên 1-3 câu ngắn.
4. Nếu câu hỏi hỏi một con số, đưa con số đó ngay ở câu đầu.
5. Chỉ đề xuất giải pháp khi người dùng hỏi ‘nên làm gì’, ‘đề xuất’, ‘tư vấn’ hoặc câu hỏi cần nhận định.
6. Nếu dữ liệu không đủ, nói rõ thiếu dữ liệu nào.
Dữ liệu thực tế: tổng vị trí={total}, đang dùng={occupied}, còn trống={empty}, xe đang gửi={active}, doanh thu={revenue:,.0f} VNĐ, lượt vào theo giờ={hourly}.
Câu hỏi của người dùng: {data.question}"""
        response = client.chat.completions.create(
            model=DEEPSEEK_MODEL,
            messages=[{"role":"system","content":"Bạn là trợ lý phân tích bãi đỗ xe."},
                      {"role":"user","content":prompt}],
            temperature=0.2
        )
        return {"answer": response.choices[0].message.content, "mode": "deepseek", "provider": "DeepSeek"}
    except Exception:
        return {"answer": local_ai(db, data.question), "mode": "fallback", "provider": "local"}

app.mount("/static", StaticFiles(directory=BASE_DIR / "app" / "static"), name="static")
