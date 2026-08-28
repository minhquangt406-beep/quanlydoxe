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

seed()


def normalize_license_plate(value: str) -> str:
    import re
    s = re.sub(r"[^A-Za-z0-9]", "", str(value or "")).upper()
    if re.fullmatch(r"\d{2}[A-Z]{2}\d{5}", s):
        return f"{s[:4]}-{s[4:7]}.{s[7:]}"
    if re.fullmatch(r"\d{2}[A-Z]\d{6}", s):
        return f"{s[:3]}-{s[3:6]}.{s[6:]}"
    if re.fullmatch(r"\d{2}[A-Z]\d{5}", s):
        return f"{s[:3]}-{s[3:6]}.{s[6:]}"
    return s

def detect_vehicle_type_from_plate(value: str) -> str:
    import re
    s = re.sub(r"[^A-Za-z0-9]", "", str(value or "")).upper()
    if re.fullmatch(r"\d{2}[A-Z]{2}\d{5}", s):
        return "Xe máy"
    return "Ô tô"

@app.get("/")
def home():
    return FileResponse(BASE_DIR / "app" / "static" / "index.html")

@app.get("/api/health")
def health():
    return {"status": "ok", "database": "connected", "time": now_vn().isoformat()}

@app.post("/api/auth/login")
def login(data: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data.username).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Sai tài khoản hoặc mật khẩu")
    audit(db, user, "LOGIN", "Đăng nhập hệ thống")
    db.commit()
    return {"access_token": token_for(user), "token_type": "bearer",
            "user": {"id": user.id, "username": user.username, "role": user.role, "full_name": user.full_name}}

@app.get("/api/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "username": user.username, "role": user.role, "full_name": user.full_name}

@app.post("/api/account/password")
def change_password(data: PasswordChange, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if len(data.new_password) < 8:
        raise HTTPException(400, "Mật khẩu mới phải có ít nhất 8 ký tự")
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(400, "Mật khẩu hiện tại không đúng")
    user.password_hash = hash_password(data.new_password)
    db.commit()
    return {"message": "Đổi mật khẩu thành công. Vui lòng đăng nhập lại."}

@app.get("/api/users")
def users(db: Session = Depends(get_db), user: User = Depends(manager_only)):
    return [{"id": u.id, "username": u.username, "role": u.role, "full_name": u.full_name}
            for u in db.query(User).order_by(User.id).all()]

@app.post("/api/users")
def create_user(data: UserCreate, db: Session = Depends(get_db), user: User = Depends(manager_only)):
    username = data.username.strip()
    if not username or len(data.password) < 8:
        raise HTTPException(400, "Tài khoản không trống và mật khẩu tối thiểu 8 ký tự")
    if data.role not in ("manager", "staff"):
        raise HTTPException(400, "Vai trò không hợp lệ")
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(409, "Tài khoản đã tồn tại")
    u = User(username=username, password_hash=hash_password(data.password), role=data.role, full_name=data.full_name.strip() or "Nhân viên")
    db.add(u); db.flush(); audit(db, user, "CREATE_USER", f"Tạo tài khoản {u.username} ({u.role})"); db.commit(); db.refresh(u)
    return {"message": "Đã tạo tài khoản", "id": u.id}

@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), user: User = Depends(manager_only)):
    if user_id == user.id:
        raise HTTPException(400, "Không thể tự xóa tài khoản đang đăng nhập")
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Tài khoản không tồn tại")
    audit(db, user, "DELETE_USER", f"Xóa tài khoản {target.username}")
    db.delete(target); db.commit()
    return {"message": "Đã xóa tài khoản"}

@app.get("/api/company")
def get_company(db: Session = Depends(get_db), user: User = Depends(current_user)):
    c = db.query(CompanySetting).first()
    if not c:
        c = CompanySetting(); db.add(c); db.commit(); db.refresh(c)
    return {"company_name": c.company_name, "phone": c.phone, "address": c.address}

@app.put("/api/company")
def update_company(data: CompanyIn, db: Session = Depends(get_db), user: User = Depends(manager_only)):
    c = db.query(CompanySetting).first()
    if not c:
        c = CompanySetting(); db.add(c)
    c.company_name = data.company_name.strip() or "Parking AI Pro"
    c.phone = data.phone.strip(); c.address = data.address.strip()
    audit(db, user, "UPDATE_COMPANY", "Cập nhật thông tin doanh nghiệp")
    db.commit()
    return {"message": "Đã lưu thông tin doanh nghiệp"}

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
    revenue = db.query(func.coalesce(func.sum(ParkingRecord.fee), 0)).scalar() or 0
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
def slots(db: Session = Depends(get_db), user: User = Depends(current_user)):
    areas_map = {a.id: a.name for a in db.query(Area).all()}
    active_rows = (db.query(ParkingRecord.slot_id, Vehicle.license_plate, Vehicle.vehicle_type, ParkingRecord.time_in)
                   .join(Vehicle, ParkingRecord.vehicle_id == Vehicle.id)
                   .filter(ParkingRecord.time_out.is_(None)).all())
    active_map = {row[0]: {"license_plate": row[1], "vehicle_type": row[2], "time_in": row[3].isoformat()} for row in active_rows}
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
def pricing(db: Session = Depends(get_db), user: User = Depends(current_user)):
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
def vehicles(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return [{"id": v.id, "license_plate": v.license_plate, "vehicle_type": v.vehicle_type}
            for v in db.query(Vehicle).order_by(Vehicle.id.desc()).all()]

@app.post("/api/checkin")
def checkin(data: CheckIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    plate = format_license_plate(data.license_plate)
    if not plate: raise HTTPException(400, "Biển số không được trống")
    detected_type = infer_vehicle_type(plate)
    # Nếu biển số khớp quy tắc thì luôn ưu tiên loại xe được nhận diện,
    # không để giá trị mặc định "Xe máy" từ form ghi đè kết quả.
    vehicle_type = detected_type or (data.vehicle_type if data.vehicle_type in ("Xe máy", "Ô tô", "Xe đạp") else "Xe máy")
    active_vehicle_ids = [x[0] for x in db.query(ParkingRecord.vehicle_id).filter(ParkingRecord.time_out.is_(None)).all()]
    existing = db.query(Vehicle).filter(Vehicle.license_plate == plate).first()
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
        existing = Vehicle(license_plate=plate, vehicle_type=vehicle_type)
        db.add(existing); db.flush()
    else:
        existing.vehicle_type = vehicle_type
    record = ParkingRecord(vehicle_id=existing.id, slot_id=slot.id, time_in=now_vn())
    slot.status = "occupied"
    db.add(record)
    audit(db, user, "CHECKIN", f"{plate} → {slot.name} ({vehicle_type})")
    db.commit(); db.refresh(record)
    return {"message": "Cho xe vào thành công", "record_id": record.id, "time_in": record.time_in.isoformat(), "slot": slot.name, "vehicle_type": vehicle_type}

def calculate_fee(db: Session, record: ParkingRecord, time_out: datetime):
    vehicle = db.get(Vehicle, record.vehicle_id)
    price = db.query(Pricing).filter(Pricing.vehicle_type == vehicle.vehicle_type).first()
    if not price: raise HTTPException(400, "Chưa có bảng giá cho loại xe")
    hours = max(1, math.ceil((time_out - record.time_in).total_seconds() / 3600))
    return hours, hours * price.price_per_hour

@app.get("/api/checkout-preview/{record_id}")
def checkout_preview(record_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    record = db.get(ParkingRecord, record_id)
    if not record or record.time_out is not None:
        raise HTTPException(404, "Lượt gửi không hợp lệ hoặc đã kết thúc")
    vehicle = db.get(Vehicle, record.vehicle_id)
    slot = db.get(ParkingSlot, record.slot_id)
    time_out = now_vn()
    hours, fee = calculate_fee(db, record, time_out)
    return {
        "record_id": record.id,
        "license_plate": vehicle.license_plate if vehicle else "",
        "vehicle_type": vehicle.vehicle_type if vehicle else "",
        "slot": slot.name if slot else "",
        "hours": hours,
        "fee": fee,
    }

@app.post("/api/checkout")
def checkout(data: CheckOut, db: Session = Depends(get_db), user: User = Depends(current_user)):
    record = db.get(ParkingRecord, data.record_id)
    if not record or record.time_out is not None:
        raise HTTPException(404, "Lượt gửi không hợp lệ hoặc đã kết thúc")
    time_out = now_vn()
    hours, fee = calculate_fee(db, record, time_out)
    record.time_out, record.fee = time_out, fee
    slot = db.get(ParkingSlot, record.slot_id)
    if slot: slot.status = "empty"
    vehicle = db.get(Vehicle, record.vehicle_id)
    method = data.payment_method if data.payment_method in ("Tiền mặt","Chuyển khoản","QR ngân hàng","Miễn phí") else "Tiền mặt"
    db.add(Payment(record_id=record.id, method=method, paid_at=now_vn(), amount=fee))
    audit(db, user, "CHECKOUT", f"{vehicle.license_plate if vehicle else record.vehicle_id} → {fee:,.0f} VNĐ · {method}")
    db.commit()
    return {"message": "Cho xe ra thành công", "record_id": record.id, "hours": hours, "fee": fee, "time_out": time_out.isoformat(), "payment_method": method}

@app.get("/api/receipt/{record_id}")
def receipt(record_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.query(ParkingRecord, Vehicle, ParkingSlot).join(Vehicle, ParkingRecord.vehicle_id == Vehicle.id).join(ParkingSlot, ParkingRecord.slot_id == ParkingSlot.id).filter(ParkingRecord.id == record_id).first()
    if not row:
        raise HTTPException(404, "Không tìm thấy hóa đơn")
    r,v,s = row; area = db.get(Area, s.area_id); company = db.query(CompanySetting).first()
    company_name = company.company_name if company else "Parking AI Pro"; phone = company.phone if company else ""; address = company.address if company else ""
    html = f"""<!doctype html><html lang='vi'><head><meta charset='utf-8'><title>Biên lai #{r.id}</title><style>body{{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;padding:24px;color:#111}}.head{{text-align:center;border-bottom:2px solid #111;padding-bottom:16px}}table{{width:100%;border-collapse:collapse;margin-top:20px}}td{{padding:10px;border-bottom:1px solid #ddd}}.total{{font-size:24px;font-weight:700;text-align:right;margin-top:20px}}button{{padding:12px 18px;border:0;border-radius:8px;background:#111;color:white;cursor:pointer}}@media print{{button{{display:none}}body{{margin:0}}}}</style></head><body><div class='head'><h1>{company_name}</h1><div>{address}</div><div>{phone}</div><h2>BIÊN LAI GỬI XE</h2><div>Mã lượt #{r.id}</div></div><table><tr><td>Biển số</td><td><b>{v.license_plate}</b></td></tr><tr><td>Loại xe</td><td>{v.vehicle_type}</td></tr><tr><td>Khu vực</td><td>{area.name if area else '—'} · {s.name}</td></tr><tr><td>Thời gian vào</td><td>{r.time_in.strftime('%d/%m/%Y %H:%M')}</td></tr><tr><td>Thời gian ra</td><td>{r.time_out.strftime('%d/%m/%Y %H:%M') if r.time_out else '—'}</td></tr></table><div class='total'>Tổng tiền: {float(r.fee or 0):,.0f} VNĐ</div><p style='text-align:center;margin-top:30px'>Cảm ơn quý khách!</p><div style='text-align:center'><button onclick='window.print()'>In biên lai</button></div></body></html>"""
    return HTMLResponse(html)

@app.get("/api/active")
def active(db: Session = Depends(get_db), user: User = Depends(current_user)):
    q = db.query(ParkingRecord, Vehicle, ParkingSlot).join(Vehicle, ParkingRecord.vehicle_id == Vehicle.id).join(ParkingSlot, ParkingRecord.slot_id == ParkingSlot.id).filter(ParkingRecord.time_out.is_(None)).order_by(ParkingRecord.time_in.desc()).all()
    return [{"id": r.id, "license_plate": v.license_plate, "vehicle_type": v.vehicle_type,
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
def history(db: Session = Depends(get_db), user: User = Depends(current_user), q: str = Query("", max_length=100)):
    rows = db.query(ParkingRecord, Vehicle, ParkingSlot).join(Vehicle, ParkingRecord.vehicle_id == Vehicle.id).join(ParkingSlot, ParkingRecord.slot_id == ParkingSlot.id).order_by(ParkingRecord.id.desc()).limit(500).all()
    result = []
    for r,v,s in rows:
        text = f"{r.id} {v.license_plate} {v.vehicle_type} {s.name}".lower()
        if q.lower() not in text: continue
        result.append({"id": r.id, "license_plate": v.license_plate, "vehicle_type": v.vehicle_type,
                       "slot": s.name, "time_in": r.time_in.isoformat(),
                       "time_out": r.time_out.isoformat() if r.time_out else None, "fee": r.fee})
    return result

@app.get("/api/auto-slot")
def auto_slot(vehicle_type: str = Query("Xe máy"), db: Session = Depends(get_db), user: User = Depends(current_user)):
    slot = db.query(ParkingSlot).filter(ParkingSlot.status == "empty").order_by(ParkingSlot.area_id, ParkingSlot.id).first()
    if not slot: raise HTTPException(409, "Bãi đã đầy")
    area = db.get(Area, slot.area_id)
    return {"slot_id": slot.id, "slot": slot.name, "area": area.name if area else "", "vehicle_type": vehicle_type}

@app.get("/api/monthly")
def monthly(db: Session = Depends(get_db), user: User = Depends(current_user)):
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
def activity(limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.query(AuditLog, User).outerjoin(User, AuditLog.user_id == User.id).order_by(AuditLog.id.desc()).limit(limit).all()
    return [{"id": a.id, "username": u.username if u else "system", "action": a.action, "detail": a.detail, "created_at": a.created_at.isoformat()} for a,u in rows]

@app.get("/api/analytics")
def analytics(db: Session = Depends(get_db), user: User = Depends(current_user)):
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
    total = db.query(ParkingSlot).count()
    occupied = db.query(ParkingSlot).filter(ParkingSlot.status == "occupied").count()
    revenue = db.query(func.coalesce(func.sum(ParkingRecord.fee), 0)).scalar() or 0
    rows = db.query(ParkingRecord.time_in).all()
    counts = {}
    for (dt,) in rows:
        counts[dt.hour] = counts.get(dt.hour, 0) + 1
    peak = max(counts, key=counts.get) if counts else None
    if not rows:
        return "Chưa có đủ dữ liệu thực tế trong database để phân tích."
    peak_text = f"{peak:02d}:00–{(peak+1)%24:02d}:00" if peak is not None else "chưa xác định"
    suggestion = f"Nên tăng nhân sự quanh {peak_text} vì đây là khung có nhiều lượt xe vào nhất theo dữ liệu hiện có."
    return (f"Phân tích từ database: hiện có {occupied}/{total} vị trí đang sử dụng "
            f"({(occupied/total*100 if total else 0):.1f}% lấp đầy), doanh thu đã ghi nhận "
            f"{revenue:,.0f} VNĐ. Khung giờ cao điểm là {peak_text}. {suggestion}")

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
        prompt = f"""Bạn là trợ lý phân tích bãi đỗ xe. Không tự tạo số liệu.
Dữ liệu thực tế: tổng vị trí={total}, đang dùng={occupied}, doanh thu={revenue},
lượt vào theo giờ={hourly}. Câu hỏi quản lý: {data.question}
Trả lời ngắn gọn, có số liệu, và nếu phù hợp hãy đề xuất vận hành/nhân sự."""
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
