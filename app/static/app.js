(function(){
  try{
    const u=new URL(window.location.href);
    if(u.searchParams.has("login_username")||u.searchParams.has("login_password")){
      history.replaceState({},document.title,u.pathname+u.hash);
    }
  }catch(_){}
})();

(function(){
  try{
    const u = new URL(window.location.href);
    if(u.searchParams.has("login_username") || u.searchParams.has("login_password")){
      history.replaceState({}, document.title, u.pathname + u.hash);
    }
  }catch(_){}
})();

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const AWAY_TIMEOUT_MS=30*60*1000;
let token=localStorage.getItem("parking_token"), me=null;
function clearAuth(){localStorage.removeItem("parking_token");localStorage.removeItem("parking_last_seen");token=null;}
function refreshLastSeen(){if(token) localStorage.setItem("parking_last_seen",String(Date.now()));}
function isAwayExpired(){const last=Number(localStorage.getItem("parking_last_seen")||0);return !!token && (!last || Date.now()-last>=AWAY_TIMEOUT_MS);}
if(isAwayExpired()) clearAuth();
refreshLastSeen();
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"){
    if(isAwayExpired()){
      clearAuth();
      location.reload();
      return;
    }
    refreshLastSeen();
  }
});
window.addEventListener("pageshow",()=>{
  if(isAwayExpired()){
    clearAuth();
    location.reload();
    return;
  }
  refreshLastSeen();
});
setInterval(()=>{
  if(document.visibilityState==="visible") refreshLastSeen();
},60000);

const titles={dashboard:"Tổng quan",parking:"Xe vào / Xe ra",slots:"Vị trí đỗ",history:"Lịch sử",vehicles:"Phương tiện",pricing:"Bảng giá",areas:"Khu vực",ai:"AI phân tích",reports:"Báo cáo doanh thu",users:"Tài khoản",settings:"Cài đặt doanh nghiệp",activity:"Nhật ký hoạt động",monthly:"Vé tháng","ai-center":"AI Center"};
async function api(path,opt={}){opt.headers={...(opt.headers||{}),...(token?{Authorization:"Bearer "+token}:{})};if(opt.body&&typeof opt.body!=="string"){opt.headers["Content-Type"]="application/json";opt.body=JSON.stringify(opt.body)}const r=await fetch(path,opt);const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.detail||"Có lỗi xảy ra");return data}
function money(n){return Number(n||0).toLocaleString("vi-VN")+" ₫"} function dt(s){return s?new Date(s).toLocaleString("vi-VN"):"—"} function duration(s){if(!s)return "—"; const ms=Math.max(0,Date.now()-new Date(s).getTime()), m=Math.floor(ms/60000), h=Math.floor(m/60), mm=m%60; return h?`${h} giờ ${mm} phút`:`${mm} phút`}
function toast(msg,type="success"){const el=$("#toast");if(!el)return;el.textContent=msg;el.className="toast show "+type;clearTimeout(window.__toast);window.__toast=setTimeout(()=>el.className="toast",2600)}
function activityMeta(action){const a=String(action||"").toUpperCase();if(a==="CHECKIN")return {cls:"checkin",icon:"↓",label:"CHECK IN"};if(a==="CHECKOUT")return {cls:"checkout",icon:"↑",label:"CHECK OUT"};if(a==="LOGIN")return {cls:"login",icon:"↪",label:"LOGIN"};return {cls:"other",icon:"•",label:String(action||"KHÁC")};}
function activityItem(x){const m=activityMeta(x.action);return `<div class="activity-item activity-${m.cls}"><div class="activity-main"><span class="activity-badge ${m.cls}"><span>${m.icon}</span>${m.label}</span><div class="activity-detail">${x.detail}</div></div><span class="activity-meta">${dt(x.created_at)} · ${x.username}</span></div>`}
const vehicleTypes=["Xe máy","Ô tô","Xe đạp"];
// Chuẩn hóa biển số Việt Nam khi người dùng nhập: 29B112345 -> 29B1-123.45
// Hỗ trợ cả 29AD12345 -> 29AD-123.45 và 29A12345 -> 29A-123.45.
const formatPlate = (rawPlate) => {
  let clean = String(rawPlate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!clean) return "";
  // Recover the old formatter's accidental duplicated first digit: 330A09123 -> 30A09123.
  if (/^(\d)\1\d[A-Z]\d{5}$/.test(clean)) clean = clean[0] + clean.slice(2);
  // Việt Nam: 2 số tỉnh + seri 1 hoặc 2 ký tự + tối đa 5 số.
  // Khi đủ dữ liệu, tự đặt dấu - và .; khi đang gõ cũng định dạng dần.
  let prefixLen = 3;
  if (clean.length >= 9 && /^\d{2}[A-Z][A-Z0-9]/.test(clean)) prefixLen = 4;
  const prefix = clean.slice(0, prefixLen);
  const numberPart = clean.slice(prefixLen, prefixLen + 5);
  if (!/^\d{2}[A-Z]/.test(prefix)) return clean;
  if (!numberPart) return prefix;
  let out = prefix + "-" + numberPart.slice(0, 3);
  if (numberPart.length > 3) out += "." + numberPart.slice(3);
  return out;
};

// Tự nhận diện loại xe theo cấu trúc biển số.
const detectVehicleType = (rawPlate) => {
  // Chuẩn hóa biển số: bỏ khoảng trắng, dấu gạch và dấu chấm để nhận diện ổn định
  // Ví dụ: 29B1-123.45 -> 29B112345, 29AD-123.45 -> 29AD12345, 29A-123.45 -> 29A12345
  const plate = String(rawPlate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!plate) return null;

  // Việt Nam: sau mã tỉnh (2 số), biển xe máy thường có mã 2 ký tự
  // dạng B1 / C1 / D1... hoặc 2 chữ như AD, AE...
  if (/^\d{2}(?:[A-Z]\d|[A-Z]{2})\d{5}$/.test(plate)) return "Xe máy";

  // Ô tô: 2 số tỉnh + 1 chữ + 5 số seri
  if (/^\d{2}[A-Z]\d{5}$/.test(plate)) return "Ô tô";

  return null;
};

const bindVehicleTypeDetection=(plateSelector,typeSelector)=>{
  const plateInput=$(plateSelector), typeSelect=$(typeSelector);
  if(!plateInput||!typeSelect||plateInput.dataset.typeDetectionBound) return;
  plateInput.dataset.typeDetectionBound="1";
  const update=()=>{
    // Only detect while typing. Never rewrite the input value here; doing so
    // can duplicate characters when the user types quickly (e.g. 30A -> 330A).
    const raw=plateInput.value;
    const detected=detectVehicleType(raw);
    if(detected){
      typeSelect.value=detected;
      typeSelect.dataset.autoDetected="1";
    }
  };
  const finish=()=>{
    const before=plateInput.value;
    const formatted=formatPlate(before);
    if(formatted && formatted!==before){
      plateInput.value=formatted;
      try { plateInput.setSelectionRange(formatted.length, formatted.length); } catch (_) {}
    }
    const detected=detectVehicleType(formatted || before);
    if(detected){
      typeSelect.value=detected;
      typeSelect.dataset.autoDetected="1";
    }
  };
  ["input","change","keyup","paste"].forEach(ev=>plateInput.addEventListener(ev,update));
  plateInput.addEventListener("blur",finish);
  update();
};

function openSlotModal(slot){
  const m=$("#slotModal"),b=$("#modalBody");
  if(!m||!b)return;
  const occupied=slot.status==="occupied";
  b.innerHTML=`
    <div class="slot-modal-shell">
      <div class="slot-modal-head">
        <div class="slot-head-icon">${occupied?"🚘":"🅿️"}</div>
        <div class="slot-head-copy">
          <div class="slot-kicker">${occupied?"PARKING SLOT DETAILS":"THÊM XE VÀO VỊ TRÍ"}</div>
          <h3>${slot.name}</h3>
          <p>${slot.area_name} <span>•</span> Vị trí ${occupied?"đang có xe":"sẵn sàng để nhận xe"}</p>
        </div>
        <button type="button" class="slot-close" id="slotModalClose" aria-label="Đóng">×</button>
      </div>

      ${occupied ? `
        <div class="slot-status occupied">
          <span class="status-icon">🚘</span>
          <div><b>VỊ TRÍ ĐANG SỬ DỤNG</b><small>${formatPlate(slot.license_plate)||"Chưa có biển số"}</small></div>
          <span class="status-dot"></span>
        </div>
        <div class="slot-info-grid">
          <div><span>BIỂN SỐ</span><b>${formatPlate(slot.license_plate)||"—"}</b></div>
          <div><span>LOẠI XE</span><b>${slot.vehicle_type||"—"}</b></div>
          <div><span>KHU VỰC</span><b>${slot.area_name}</b></div>
          <div><span>THỜI GIAN VÀO</span><b>${dt(slot.time_in)||"—"}</b></div>
        </div>
      ` : `
        <div class="slot-status ready">
          <span class="status-icon">✓</span>
          <div><b>VỊ TRÍ SẴN SÀNG</b><small>Xe sẽ được gán trực tiếp vào ${slot.name}</small></div>
          <span class="status-dot"></span>
        </div>

        <div class="slot-info-strip">
          <div><span>📍</span><div><small>Vị trí</small><b>${slot.name}</b></div></div>
          <div><span>▦</span><div><small>Khu vực</small><b>${slot.area_name}</b></div></div>
          <div><span>✓</span><div><small>Trạng thái</small><b>Sẵn sàng</b></div></div>
        </div>

        <div class="quick-checkin beautiful-add">
          <div class="quick-title-row">
            <div class="add-icon">🚗</div>
            <div><div class="quick-title">THÊM XE VÀO VỊ TRÍ</div><div class="quick-sub">Nhập biển số, hệ thống sẽ tự nhận diện loại xe.</div></div>
          </div>
          <div class="quick-form-grid">
            <label class="plate-field">BIỂN SỐ XE
              <div class="plate-input-wrap"><span>⌕</span><input id="quickPlate" autocomplete="off" inputmode="text" autocapitalize="characters" placeholder="30A12345"></div>
              <small class="field-hint">Ví dụ: 30A12345 → 30A-123.45</small>
            </label>
            <label>LOẠI XE
              <select id="quickVtype">${vehicleTypes.map(v=>`<option value="${v}">${v}</option>`).join("")}</select>
              <small class="field-hint" id="quickDetectHint">Đang chờ biển số...</small>
            </label>
          </div>
          <div class="auto-detect-note">✨ <span><b>Tự động nhận diện</b> loại xe từ biển số</span><span class="detect-badge" id="detectBadge">Chờ nhập</span></div>
        </div>
      `}

      <div class="modal-actions slot-actions">
        ${occupied
          ? `<button class="btn" id="modalCancelCheckin">Đóng</button><button class="primary" id="modalCheckout">💳 Tính phí & xe ra</button>`
          : `<button class="btn" id="modalCancelCheckin">Hủy bỏ</button><button class="primary" id="modalCheckin">🚗 Thêm xe vào ${slot.name}</button>`}
      </div>
    </div>`;
  m.classList.remove("hidden");
  document.body.classList.add("modal-open");
  const close=()=>{m.classList.add("hidden");document.body.classList.remove("modal-open");};
  $("#slotModalClose").onclick=close;
  $(".modal-backdrop").onclick=close;

  if(occupied){
    $("#modalCancelCheckin").onclick=close;
    $("#modalCheckout").onclick=async()=>{
      try{
        const active=await api("/api/active");
        const row=active.find(x=>x.slot===slot.name);
        if(!row) throw new Error("Không tìm thấy lượt gửi đang hoạt động");
        close();
        await openPaymentModal(row.id);
      }catch(e){toast(e.message,"error")}
    };
  }else{
    $("#modalCancelCheckin").onclick=close;
    const plateInput=$("#quickPlate"), typeSelect=$("#quickVtype");
    const update=()=>{
      const raw=plateInput.value||"";
      const clean=raw.toUpperCase().replace(/[^A-Z0-9]/g,"");
      const detected=clean.length>=5 ? detectVehicleType(clean) : "";
      if(detected){
        typeSelect.value=detected;
        typeSelect.dataset.autoDetected="1";
        $("#quickDetectHint").textContent=`Đã nhận diện: ${detected}`;
        $("#detectBadge").textContent=detected;
        $("#detectBadge").className="detect-badge detected";
      }else{
        $("#quickDetectHint").textContent="Đang chờ biển số...";
        $("#detectBadge").textContent="Chờ nhập";
        $("#detectBadge").className="detect-badge";
      }
    };
    ["input","keyup","change","paste"].forEach(ev=>plateInput.addEventListener(ev,update));
    plateInput.addEventListener("blur",()=>{
      const formatted=formatPlate(plateInput.value);
      if(formatted)plateInput.value=formatted;
      update();
    });
    update();

    const submit=async()=>{
      const plate=plateInput.value.trim();
      if(!plate){toast("Vui lòng nhập biển số xe","error");plateInput.focus();return;}
      const formatted=formatPlate(plate);
      const vehicleType=detectVehicleType(formatted)||typeSelect.value||"Xe máy";
      const btn=$("#modalCheckin");
      btn.disabled=true;btn.textContent="Đang thêm xe...";
      try{
        await api("/api/checkin",{method:"POST",body:{license_plate:formatted,vehicle_type:vehicleType,slot_id:Number(slot.id)}});
        close();
        toast(`✓ ${formatted} đã vào ${slot.name}`);
        await navigate("dashboard");
      }catch(e){
        toast(e.message,"error");
        btn.disabled=false;btn.textContent=`🚗 Thêm xe vào ${slot.name}`;
      }
    };
    $("#modalCheckin").onclick=submit;
    plateInput.addEventListener("keydown",e=>{if(e.key==="Enter")submit()});
    setTimeout(()=>plateInput.focus(),100);
  }
}
function wireMapInteractions(){const s=window.__latestSlots||[];$$('.real-slot').forEach(el=>el.onclick=()=>{const x=s.find(v=>String(v.id)===el.dataset.slotId);if(x)openSlotModal(x)});$$('.map-zone').forEach(z=>z.onclick=e=>{if(e.target.closest('.real-slot'))return;$$('.map-zone').forEach(v=>v.classList.remove('zone-focus'));z.classList.add('zone-focus');setTimeout(()=>z.classList.remove('zone-focus'),900);toast(`Đã chọn ${z.querySelector('.zone-chip')?.textContent||"khu vực"}`)});}

async function openPaymentModal(recordId){
  const modal=document.querySelector("#slotModal");
  const body=document.querySelector("#modalBody");
  if(!modal||!body)return;
  try{
    const d=await api(`/api/checkout-preview/${recordId}`);
    const plate=formatPlate(d.license_plate);
    const amountValue=Math.max(0, Number(d.fee||0));
    const amount=money(amountValue);
    const cleanPlate=String(plate).replace(/[^A-Z0-9]/g,"");
    const transferContent=`VE-${cleanPlate}`;
    const vietQrUrl=(value)=>`https://img.vietqr.io/image/TCB-998888056789-compact2.png?amount=${Math.max(0,Math.round(Number(value)||0))}&addInfo=${encodeURIComponent(transferContent)}&accountName=${encodeURIComponent("NONG MINH QUANG")}&t=${Date.now()}`;
    body.innerHTML=`
      <div class="pay-shell">
        <div class="pay-head">
          <div class="pay-head-icon">🚗</div>
          <div>
            <div class="pay-kicker">THANH TOÁN & XE RA</div>
            <h2>Thanh toán</h2>
            <p>Vui lòng chọn phương thức thanh toán</p>
          </div>
          <button type="button" class="pay-close" id="paymentClose" aria-label="Đóng">×</button>
        </div>

        <div class="pay-vehicle-card">
          <div class="pay-car-icon">🚘</div>
          <div class="pay-vehicle-info">
            <div class="pay-plate">${plate}</div>
            <div class="pay-meta">${d.vehicle_type||"—"} <span>•</span> ${d.slot||"—"}</div>
            <div class="pay-parked-time">⏱ Đã đỗ: <b>${d.duration_text||`${d.hours} giờ`}</b></div>
          </div>
          <div class="pay-duration"><small>THỜI GIAN TÍNH PHÍ</small><b>${d.billable_hours != null ? d.billable_hours.toFixed(2) : d.hours} giờ</b><em>tính chính xác theo phút</em></div>
        </div>

        <div class="pay-total-card" id="paymentTotalCard">
          <span>TỔNG THANH TOÁN</span>
          <strong id="paymentTotalAmount">${amount}</strong>
          <small id="paymentCalculation">${d.billing_text||`${d.billable_hours != null ? d.billable_hours.toFixed(2) : d.hours} giờ tính phí`}</small>
        </div>

        <div class="pay-section-title">CHỌN PHƯƠNG THỨC THANH TOÁN</div>

        <div class="pay-method-list">
          <button type="button" class="pay-method active" data-method="Tiền mặt">
            <span class="pay-radio"></span><span class="pay-method-icon cash">💵</span>
            <span class="pay-method-text"><b>Tiền mặt</b><small>Thanh toán bằng tiền mặt</small></span>
            <span class="pay-method-side">💵</span>
          </button>
          <button type="button" class="pay-method" data-method="Chuyển khoản">
            <span class="pay-radio"></span><span class="pay-method-icon bank">🏦</span>
            <span class="pay-method-text"><b>Chuyển khoản</b><small>Chuyển khoản ngân hàng</small></span>
            <span class="pay-method-side">🏦</span>
          </button>
          <button type="button" class="pay-method" data-method="QR ngân hàng">
            <span class="pay-radio"></span><span class="pay-method-icon qr">▦</span>
            <span class="pay-method-text"><b>Quét mã QR</b><small>Quét QR để thanh toán</small></span>
            <span class="pay-method-badge">VIETQR<br><em>napas 247</em></span>
          </button>
          <button type="button" class="pay-method" data-method="Miễn phí">
            <span class="pay-radio"></span><span class="pay-method-icon free">🎁</span>
            <span class="pay-method-text"><b>Miễn phí</b><small>Không thu phí</small></span>
            <span class="pay-method-side">🎁</span>
          </button>
        </div>

        <div id="paymentBank" class="pay-qr-panel hidden">
          <div class="pay-qr-title">THÔNG TIN CHUYỂN KHOẢN</div>
          <div class="pay-bank-info">
            <div><span>🏦</span><label>Ngân hàng</label><b>TECHCOMBANK</b></div>
            <div><span>👤</span><label>Chủ tài khoản</label><b>NONG MINH QUANG</b></div>
            <div><span>💳</span><label>Số tài khoản</label><b>9988 8805 6789</b></div>
            <div><span>●</span><label>Số tiền</label><strong id="paymentBankAmount">${amount}</strong></div>
            <div><span>▤</span><label>Nội dung CK</label><b>${transferContent}</b></div>
          </div>
        </div>

        <div id="paymentQR" class="pay-qr-panel hidden">
          <div class="pay-qr-title">THÔNG TIN MÃ QR</div>
          <div class="pay-qr-grid">
            <div class="pay-qr-image-wrap">
              <img id="paymentQRImage" src="${vietQrUrl(amountValue)}" alt="Mã QR Techcombank với đúng số tiền thanh toán">
            </div>
            <div class="pay-qr-info">
              <div><span>🏦</span><label>Ngân hàng</label><b>TECHCOMBANK</b></div>
              <div><span>👤</span><label>Chủ tài khoản</label><b>NONG MINH QUANG</b></div>
              <div><span>💳</span><label>Số tài khoản</label><b>9988 8805 6789</b></div>
              <div><span>●</span><label>Số tiền</label><strong>${amount}</strong></div>
              <div><span>▤</span><label>Nội dung CK</label><b>${transferContent}</b></div>
            </div>
          </div>
        </div>

        <div class="pay-tip">ⓘ <span>Sau khi thanh toán, vui lòng nhấn <b>"Đã thanh toán"</b> để xác nhận. Hệ thống sẽ cho xe ra khỏi bãi.</span></div>

        <div class="pay-actions">
          <button type="button" class="pay-cancel" id="paymentCancel">×&nbsp; Hủy bỏ</button>
          <button type="button" class="pay-confirm" id="paymentConfirm">✓&nbsp; Đã thanh toán</button>
        </div>
        <div class="pay-security">🔒 Thông tin thanh toán được bảo mật tuyệt đối</div>
      </div>`;

    modal.classList.remove("hidden");
    document.body.classList.add("modal-open");
    // Ẩn nút đóng mặc định của modal để không bị trùng với nút X của giao diện thanh toán.
    const outerClose=document.querySelector("#modalClose");
    if(outerClose) outerClose.style.display="none";

    const close=()=>{
      modal.classList.add("hidden");
      document.body.classList.remove("modal-open");
      if(outerClose) outerClose.style.display="";
    };
    document.querySelector("#paymentClose").onclick=close;
    document.querySelector("#paymentCancel").onclick=close;

    let method="Tiền mặt";
    document.querySelectorAll(".pay-method").forEach(btn=>{
      btn.onclick=()=>{
        method=btn.dataset.method;
        document.querySelectorAll(".pay-method").forEach(x=>x.classList.toggle("active",x===btn));
        const isBank = method === "Chuyển khoản";
        const isQR = method === "QR ngân hàng";
        const isFree = method === "Miễn phí";
        document.querySelector("#paymentQR").classList.toggle("hidden",!isQR);
        document.querySelector("#paymentBank").classList.toggle("hidden",!isBank);
        const totalValue = isFree ? 0 : amountValue;
        const total = money(totalValue);
        document.querySelector("#paymentTotalAmount").textContent = total;
        const calc=document.querySelector("#paymentCalculation");
        if(calc) calc.textContent = isFree ? "Miễn phí · không thu tiền" : (d.billing_text||`${d.billable_hours != null ? d.billable_hours.toFixed(2) : d.hours} giờ tính phí`);
        document.querySelector("#paymentBankAmount").textContent = total;
        const qrImage=document.querySelector("#paymentQRImage");
        if(qrImage) qrImage.src=vietQrUrl(totalValue);
      };
    });

    document.querySelector("#paymentConfirm").onclick=async()=>{
      const btn=document.querySelector("#paymentConfirm");
      btn.disabled=true;
      btn.textContent="Đang xử lý...";
      try{
        const result=await api("/api/checkout",{method:"POST",body:{record_id:recordId,payment_method:method}});
        close();
        toast(`✓ Đã thanh toán ${money(result.fee)} · ${method}`);
        await navigate("dashboard");
      }catch(e){
        toast(e.message,"error");
        btn.disabled=false;
        btn.textContent='✓  Đã thanh toán';
      }
    };
  }catch(e){toast(e.message,"error");}
}


function normalizePlate(value){
  let x=String(value||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
  if(!x) return "";
  if(/^\d{2}[A-Z]{2}\d{5}$/.test(x)) return x.slice(0,4)+"-"+x.slice(4,7)+"."+x.slice(7);
  if(/^\d{2}[A-Z]\d{6}$/.test(x)) return x.slice(0,3)+"-"+x.slice(3,6)+"."+x.slice(6);
  if(/^\d{2}[A-Z]\d{5}$/.test(x)) return x.slice(0,3)+"-"+x.slice(3,6)+"."+x.slice(6);
  return x;
}

function vehicleIcon(type){
  const t=String(type||'').toLowerCase();
  if(t.includes('máy')) return '<svg class="vehicle-svg bike-svg" viewBox="0 0 64 64" aria-label="Xe máy"><circle cx="18" cy="47" r="9"/><circle cx="48" cy="47" r="9"/><path d="M18 47l9-19h12l9 19M27 28l7 19M34 47h14M38 22h7l4 7M27 28l-5-6h8" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return '<svg class="vehicle-svg car-svg" viewBox="0 0 64 64" aria-label="Ô tô"><path d="M12 39l5-15c1-3 3-5 6-5h18c3 0 5 2 6 5l5 15v9H12z" fill="currentColor"/><path d="M19 29h26l-3-7H22z" fill="#fff" opacity=".82"/><rect x="17" y="36" width="8" height="5" rx="2" fill="#fff"/><rect x="39" y="36" width="8" height="5" rx="2" fill="#fff"/><circle cx="20" cy="49" r="5" fill="#1f2937"/><circle cx="44" cy="49" r="5" fill="#1f2937"/></svg>';
}
function emptyIcon(){return '<svg class="empty-svg" viewBox="0 0 64 64" aria-label="Chỗ trống"><rect x="14" y="14" width="36" height="36" rx="4" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="7 6"/></svg>'}

async function boot(){if(!token)return;try{me=await api("/api/me");$("#loginView").classList.add("hidden");$("#appView").classList.remove("hidden");$("#userName").textContent=me.full_name;$("#userRole").textContent=me.role==="manager"?"Quản lý":"Nhân viên";$("#avatar").textContent=me.full_name[0];$$(".manager-only").forEach(x=>x.style.display=me.role==="manager"?"flex":"none");$("#mobileBottomNav")?.classList.toggle("manager",me.role==="manager");await navigate("dashboard")}catch(e){clearAuth()}}
$("#loginForm").onsubmit=async e=>{e.preventDefault();$("#loginError").textContent="";try{let d=await api("/api/auth/login",{method:"POST",body:{username:$("#username").value,password:$("#password").value}});token=d.access_token;localStorage.setItem("parking_token",token);refreshLastSeen();await boot()}catch(e){$("#loginError").textContent=e.message}};
$("#logout").onclick=()=>{clearAuth();location.reload()};
$("#nav").onclick=e=>{let b=e.target.closest("button[data-page]");if(b)navigate(b.dataset.page)};
async function navigate(page){$$("[data-page]").forEach(x=>x.classList.toggle("active",x.dataset.page===page));$("#pageTitle").textContent=titles[page];try{await pages[page]();if(page==="dashboard"||page==="slots")wireMapInteractions()}catch(e){$("#content").innerHTML=`<div class="panel"><b>Lỗi:</b> ${e.message}</div>`}}
async function renderSlots(){let s=await api("/api/slots");return s.map(x=>`<div class="slot ${x.status}">${x.name}<br><small>${x.status==="empty"?"TRỐNG":"ĐANG DÙNG"}</small></div>`).join("")}
async function downloadBackup(){const r=await fetch('/api/backup',{headers:{Authorization:'Bearer '+token}});if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.detail||'Không thể sao lưu');}const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='parking-backup-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.db';a.click();URL.revokeObjectURL(url)}
async function openReceipt(id){const r=await fetch('/api/receipt/'+id,{headers:{Authorization:'Bearer '+token}});if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.detail||'Không thể tạo biên lai');}const blob=await r.blob();const url=URL.createObjectURL(blob);window.open(url,'_blank');setTimeout(()=>URL.revokeObjectURL(url),60000)}

window.pages={
dashboard:async()=>{let d=await api("/api/dashboard"),an=await api("/api/analytics"),s=await api("/api/slots"),a=await api("/api/active"),log=await api("/api/activity?limit=8");d={...d,...an};window.__latestSlots=s;
const areas=[...new Map(s.map(x=>[x.area_id,{id:x.area_id,name:x.area_name,slots:[]}])).values()]; s.forEach(x=>areas.find(ar=>ar.id===x.area_id)?.slots.push(x));
const zone=(ar)=>{const occupied=ar.slots.filter(x=>x.status==="occupied").length,empty=ar.slots.length-occupied; const cls=ar.name.toLowerCase().includes("b")?"zone-b":"zone-a"; return `<div class="map-zone ${cls}" data-area-id="${ar.id}"><div class="zone-title"><div><span class="zone-chip">${ar.name.toUpperCase()}</span><h3>${ar.name} · Sơ đồ bãi</h3><span class="muted">${ar.slots.length} vị trí · ${empty} trống · ${occupied} đang dùng</span></div><span class="pill ${empty?"green":"red"}">${empty?"CÒN CHỖ":"ĐẦY"}</span></div><div class="real-slot-grid">${ar.slots.map(x=>{const vt=x.vehicle_type||"Ô tô";const vcls=vt.toLowerCase().includes("máy")?"vehicle-bike":"vehicle-car";return `<div class="real-slot ${x.status} ${x.status==="occupied"?vcls:""}" data-slot-id="${x.id}" data-area-id="${ar.id}"><div class="slot-top"><span>${x.name}</span><span>${x.status==="occupied"?vt:""}</span></div><div class="slot-icon">${x.status==="occupied"?vehicleIcon(vt):emptyIcon()}</div>${x.status==="occupied"?`<span class="plate">${formatPlate(x.license_plate)||"NO PLATE"}</span>`:`<span class="slot-status">CHỖ TRỐNG</span>`}<span class="slot-status">${x.status==="occupied"?"ĐANG SỬ DỤNG":"SẴN SÀNG"}</span></div>`}).join("")}</div></div>`};
const maps=areas.map(zone).join("");
$("#content").innerHTML=`<div class="cards"><div class="card"><div class="label">XE ĐANG GỬI</div><div class="metric">${d.active_vehicles}</div><div class="trend">● Đang vận hành</div></div><div class="card"><div class="label">Ô TRỐNG</div><div class="metric">${d.empty}</div><div class="trend">${d.total_slots} tổng vị trí</div></div><div class="card"><div class="label">LƯỢT XE VÀO HÔM NAY</div><div class="metric">${d.today_checkins}</div><div class="trend">Dữ liệu thực tế</div></div><div class="card"><div class="label">LƯỢT XE RA HÔM NAY</div><div class="metric">${d.today_checkouts}</div><div class="trend">Đã hoàn tất</div></div><div class="card"><div class="label">DOANH THU HÔM NAY</div><div class="metric">${money(d.today_revenue)}</div><div class="trend">${d.closed_records} lượt hoàn tất toàn hệ thống</div></div><div class="card"><div class="label">TỶ LỆ LẤP ĐẦY</div><div class="metric">${d.occupancy_rate}%</div><div class="trend">Cao điểm ${d.peak_hour}</div></div></div>
<div class="panel area-overview"><div class="panel-head"><div><h3>Bản đồ bãi xe thực tế</h3><span class="muted">Biển số hiển thị trực tiếp trên ô đang đỗ</span></div><span class="pill green">LIVE MAP</span></div><div class="parking-map">${maps}<div class="map-legend"><span><i class="legend-dot legend-empty"></i>Trống</span><span><i class="legend-dot legend-occupied"></i>Đang đỗ</span></div></div></div>
<div class="panel active-panel"><div class="panel-head"><h3>Xe đang trong bãi</h3><span class="muted">${a.length} xe</span></div>${a.length?a.slice(0,10).map(x=>`<div class="active-row" data-time-in="${x.time_in}" style="display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)"><div><b>${formatPlate(x.license_plate)}</b><div class="muted">${x.slot} · ${x.vehicle_type}</div></div><span class="muted">${dt(x.time_in)}<br><b class="duration" data-time="${x.time_in}">${duration(x.time_in)}</b></span></div>`).join(""):`<div class="empty-state">Chưa có xe đang gửi</div>`}</div><div class="panel"><div class="panel-head"><div><h3>Nhật ký hoạt động</h3><span class="muted">8 thao tác gần nhất</span></div><button class="btn" id="openActivity">Xem tất cả</button></div><div class="activity-list">${log.length?log.map(activityItem).join(""):'<div class="empty-state">Chưa có nhật ký</div>'}</div></div>`;document.getElementById("openActivity")?.addEventListener("click",()=>navigate("activity"));window.clearInterval(window.__durationTimer);window.__durationTimer=setInterval(()=>$$('.duration').forEach(e=>e.textContent=duration(e.dataset.time)),30000);wireMapInteractions()},
parking:async()=>{let slots=await api("/api/slots"),active=await api("/api/active");$("#content").innerHTML=`
<div class="grid2"><div class="panel"><div class="panel-head"><div><h3>Cho xe vào</h3><span class="muted">Chọn khu trước, sau đó chọn vị trí</span></div><span class="pill green">A / B</span></div><div class="form-grid"><label>Biển số<input id="plate" placeholder="29A-123.45"></label><label>Loại xe<select id="vtype"><option>Xe máy</option><option>Ô tô</option></select></label><label>Khu vực<select id="areaFilter"><option value="all">Tất cả khu</option>${[...new Map(slots.map(x=>[x.area_id,x.area_name]))].map(([id,name])=>`<option value="${id}">${name}</option>`).join("")}</select></label><label>Vị trí<select id="slot">${slots.filter(x=>x.status==="empty").map(x=>`<option value="${x.id}" data-area="${x.area_id}">${x.area_name} · ${x.name}</option>`).join("")}</select></label></div><button class="primary" id="checkin" style="margin-top:14px">+ Cho xe vào</button><div id="parkingMsg"></div></div>
<div class="panel"><div class="panel-head"><h3>Xe đang gửi</h3><span class="muted">${active.length} xe</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Mã</th><th>Biển số</th><th>Vị trí</th><th>Thời gian</th><th></th></tr></thead><tbody>${active.map(x=>`<tr><td>#${x.id}</td><td><b>${formatPlate(x.license_plate)}</b></td><td>${x.slot}</td><td>${dt(x.time_in)}</td><td><button class="btn checkout" data-id="${x.id}">Tính phí & xe ra</button></td></tr>`).join("")||`<tr><td colspan="5" class="empty-state">Không có xe</td></tr>`}</tbody></table></div></div></div>`;
bindVehicleTypeDetection("#plate","#vtype");$("#checkin").onclick=async()=>{try{let d=await api("/api/checkin",{method:"POST",body:{license_plate:$("#plate").value,vehicle_type:$("#vtype").value,slot_id:+$("#slot").value}});$("#parkingMsg").innerHTML=`<div class="notice">✓ ${d.message} · Mã lượt <b>#${d.record_id}</b> · ${d.slot}</div>`;await pages.parking()}catch(e){$("#parkingMsg").innerHTML=`<div class="error">${e.message}</div>`}};
$("#areaFilter").onchange=()=>{const area=$("#areaFilter").value; $$("#slot option").forEach(o=>o.hidden=area!=="all" && o.dataset.area!==area); const first=$$("#slot option").find(o=>!o.hidden); if(first) $("#slot").value=first.value;};
$$(".checkout").forEach(b=>b.onclick=()=>openPaymentModal(+b.dataset.id))},
slots:async()=>{let s=await api("/api/slots");window.__latestSlots=s; const areas=[...new Map(s.map(x=>[x.area_id,{id:x.area_id,name:x.area_name,slots:[]}])).values()]; s.forEach(x=>areas.find(ar=>ar.id===x.area_id)?.slots.push(x)); const zone=(ar)=>{const occupied=ar.slots.filter(x=>x.status==="occupied").length,empty=ar.slots.length-occupied;const cls=ar.name.toLowerCase().includes("b")?"zone-b":"zone-a";return `<div class="panel area-panel-large"><div class="parking-map"><div class="map-zone ${cls}" data-area-id="${ar.id}"><div class="zone-title"><div><span class="zone-chip">${ar.name.toUpperCase()}</span><h3>${ar.name} · Sơ đồ vị trí</h3><span class="muted">${ar.slots.length} vị trí · ${empty} trống · ${occupied} đang dùng</span></div><span class="pill ${empty?"green":"red"}">${empty?"CÒN CHỖ":"ĐẦY"}</span></div><div class="real-slot-grid">${ar.slots.map(x=>{const vt=x.vehicle_type||"Ô tô";const vcls=vt.toLowerCase().includes("máy")?"vehicle-bike":"vehicle-car";return `<div class="real-slot ${x.status} ${x.status==="occupied"?vcls:""}" data-slot-id="${x.id}" data-area-id="${ar.id}"><div class="slot-top"><span>${x.name}</span><span>${x.status==="occupied"?vt:""}</span></div><div class="slot-icon">${x.status==="occupied"?vehicleIcon(vt):emptyIcon()}</div>${x.status==="occupied"?`<span class="plate">${formatPlate(x.license_plate)||"NO PLATE"}</span>`:`<span class="slot-status">CHỖ TRỐNG</span>`}<span class="slot-status">${x.status==="occupied"?"ĐANG SỬ DỤNG":"SẴN SÀNG"}</span></div>`}).join("")}</div></div></div></div>`}; $("#content").innerHTML=`<div class="notice">Bản đồ được chia riêng theo từng khu. <b>Biển số</b> nằm ngay trên ô đang sử dụng.</div><div class="area-list">${areas.map(zone).join("")}</div>`},
history:async()=>{let h=await api("/api/history");const rowHtml=row=>`<tr><td>#${row.id}</td><td><b>${formatPlate(row.license_plate)}</b></td><td>${row.vehicle_type}</td><td>${row.slot}</td><td>${dt(row.time_in)}</td><td>${dt(row.time_out)}</td><td>${row.fee?money(row.fee):"—"}</td><td><span class="pill ${row.time_out?"green":"red"}">${row.time_out?"Đã ra":"Đang gửi"}</span></td>${me?.role==="manager"?`<td><button class="btn danger delete-history" data-id="${row.id}">🗑 Xóa</button></td>`:""}</tr>`;const render=x=>x.map(rowHtml).join("");$("#content").innerHTML=`<div class="panel"><div class="panel-head"><h3>Lịch sử lượt gửi</h3><input id="search" style="width:240px;margin:0" placeholder="Tìm biển số, mã lượt..."></div><div class="table-wrap"><table class="table"><thead><tr><th>Mã</th><th>Biển số</th><th>Loại</th><th>Vị trí</th><th>Vào</th><th>Ra</th><th>Phí</th><th>Trạng thái</th>${me?.role==="manager"?"<th></th>":""}</tr></thead><tbody id="hist">${render(h)}</tbody></table></div></div>`;const bindDelete=()=>$$('.delete-history').forEach(b=>b.onclick=async()=>{if(!confirm(`Xóa lượt #${b.dataset.id}?\n\nDữ liệu lượt gửi này sẽ bị xóa khỏi lịch sử.`))return;try{const d=await api(`/api/history/${b.dataset.id}`,{method:"DELETE"});toast(d.message);await pages.history()}catch(e){toast(e.message,"error")}});bindDelete();$("#search").oninput=async()=>{let x=await api("/api/history?q="+encodeURIComponent($("#search").value));$("#hist").innerHTML=render(x);bindDelete()}},
vehicles:async()=>{let v=await api("/api/vehicles");$("#content").innerHTML=`<div class="panel"><div class="panel-head"><h3>Danh sách phương tiện</h3><span class="muted">${v.length} phương tiện</span></div><table class="table"><thead><tr><th>ID</th><th>Biển số</th><th>Loại xe</th>${me?.role==="manager"?"<th></th>":""}</tr></thead><tbody>${v.map(x=>`<tr><td>${x.id}</td><td><b>${formatPlate(x.license_plate)}</b></td><td>${x.vehicle_type}</td>${me?.role==="manager"?`<td><button class="btn danger delete-vehicle" data-id="${x.id}" data-plate="${x.license_plate}">🗑 Xóa xe</button></td>`:""}</tr>`).join("")}</tbody></table></div>`;$$('.delete-vehicle').forEach(b=>b.onclick=async()=>{if(!confirm(`Xóa xe ${b.dataset.plate}?\n\nXe đã có lịch sử sẽ được hệ thống bảo vệ và không cho xóa để tránh mất dữ liệu.`))return;try{const d=await api(`/api/vehicles/${b.dataset.id}`,{method:"DELETE"});toast(d.message);await pages.vehicles();await pages.dashboard()}catch(e){toast(e.message,"error")}})},
pricing:async()=>{let p=await api("/api/pricing");$("#content").innerHTML=`<div class="panel"><div class="panel-head"><h3>Bảng giá</h3><span class="muted">Quản lý mức phí theo giờ</span></div><div class="form-grid"><label>Loại xe<select id="ptype"><option>Xe máy</option><option>Ô tô</option></select></label><label>Giá / giờ<input id="price" type="number" min="0" placeholder="5000"></label><button class="primary" id="savePrice">Lưu bảng giá</button></div><table class="table" style="margin-top:20px"><thead><tr><th>Loại xe</th><th>Giá/giờ</th></tr></thead><tbody>${p.map(x=>`<tr><td>${x.vehicle_type}</td><td><b>${money(x.price_per_hour)}</b></td></tr>`).join("")}</tbody></table></div>`;$("#savePrice").onclick=async()=>{await api("/api/pricing",{method:"POST",body:{vehicle_type:$("#ptype").value,price_per_hour:+$("#price").value}});await pages.pricing()}},
areas:async()=>{let a=await api("/api/areas");$("#content").innerHTML=`<div class="panel"><div class="panel-head"><div><h3>Khu vực bãi xe</h3><span class="muted">Quản lý, thêm hoặc xóa từng khu</span></div><span class="pill green">${a.length} KHU</span></div><div class="form-grid"><label>Tên khu vực<input id="aname" placeholder="Khu C"></label><label>Sức chứa<input id="acap" type="number" min="1" value="10"></label><button class="primary" id="addArea">+ Tạo khu vực</button></div><div class="area-admin-grid" style="margin-top:20px">${a.map(x=>`<div class="card area-admin-card"><div class="area-admin-head"><div><span class="zone-chip">${x.name.toUpperCase()}</span><b class="area-admin-name">${x.name}</b></div><button class="btn danger delete-area" data-id="${x.id}" data-name="${x.name}">🗑 Xóa khu</button></div><div class="metric">${x.empty}<small style="font-size:12px;color:var(--muted)"> / ${x.capacity} trống</small></div><span class="muted">${x.occupied} đang sử dụng</span><div class="area-progress"><span style="width:${x.capacity?Math.min(100,(x.occupied/x.capacity)*100):0}%"></span></div>${x.occupied?`<div class="click-hint">⚠ Khu đang có xe — chưa thể xóa</div>`:`<div class="click-hint">Có thể xóa nếu chưa có lịch sử gửi xe</div>`}</div>`).join("")}</div></div>`;$("#addArea").onclick=async()=>{try{await api("/api/areas",{method:"POST",body:{name:$("#aname").value,capacity:+$("#acap").value}});await pages.areas()}catch(e){toast(e.message,"error")}};$$('.delete-area').forEach(btn=>btn.onclick=async()=>{const name=btn.dataset.name;if(!confirm(`Xóa ${name}?\n\nKhu chỉ được xóa khi không có xe và chưa có lịch sử gửi xe.`))return;try{const d=await api(`/api/areas/${btn.dataset.id}`,{method:"DELETE"});toast(d.message,"success");await pages.areas();await pages.dashboard()}catch(e){toast(e.message,"error")}})},
ai:async()=>{$("#content").innerHTML=`<div class="grid2"><div class="panel"><div class="panel-head"><h3>Trợ lý AI vận hành</h3><span class="pill green">LIVE DATA</span></div><div class="notice">AI chỉ phân tích dữ liệu thực tế từ database. AI sử dụng DeepSeek để phân tích dữ liệu bãi xe và có thể chuyển sang phân tích cục bộ khi API chưa sẵn sàng.</div><label>Câu hỏi quản lý<textarea id="question" style="width:100%;min-height:120px;border:1px solid var(--line);border-radius:12px;padding:13px" placeholder="Khung giờ nào đông nhất và nên bố trí nhân sự thế nào?"></textarea></label><button class="primary" id="ask">✦ Phân tích ngay</button></div><div class="panel"><div class="panel-head"><h3>Kết quả phân tích</h3></div><div id="aiResult" class="ai-box">Đang chờ câu hỏi...</div></div></div>`;$("#ask").onclick=async()=>{let q=$("#question").value;$("#aiResult").textContent="AI đang phân tích dữ liệu...";try{let d=await api("/api/ai",{method:"POST",body:{question:q}});$("#aiResult").textContent=d.answer+`\\n\\n[Chế độ: ${d.mode}]`}catch(e){$("#aiResult").textContent=e.message}}}
};

window.pages.reports=async()=>{const d=await api('/api/reports?days=30');const daily=Object.entries(d.daily).sort((a,b)=>a[0].localeCompare(b[0]));const max=Math.max(1,...daily.map(x=>x[1]));const bars=daily.slice(-14).map(([day,val])=>`<div class="report-bar-row"><span>${day.slice(5)}</span><div class="report-bar"><i style="width:${Math.max(2,val/max*100)}%"></i></div><b>${money(val)}</b></div>`).join('');const areas=Object.entries(d.by_area).sort((a,b)=>b[1]-a[1]).map(([name,val])=>`<tr><td>${name}</td><td><b>${money(val)}</b></td></tr>`).join('');$('#content').innerHTML=`<div class="cards"><div class="card"><div class="label">DOANH THU 30 NGÀY</div><div class="metric">${money(d.total_revenue)}</div><div class="trend">Theo lượt đã hoàn tất</div></div><div class="card"><div class="label">LƯỢT ĐÃ THANH TOÁN</div><div class="metric">${d.closed_records}</div><div class="trend">Trong 30 ngày gần nhất</div></div></div><div class="grid2"><div class="panel"><div class="panel-head"><div><h3>Doanh thu theo ngày</h3><span class="muted">14 ngày gần nhất có dữ liệu</span></div><span class="pill green">BUSINESS</span><button class="btn" id="exportHistory">⇩ Xuất CSV</button></div><div class="report-bars">${bars||'<div class="empty-state">Chưa có dữ liệu doanh thu</div>'}</div></div><div class="panel"><div class="panel-head"><h3>Doanh thu theo khu</h3></div><table class="table"><thead><tr><th>Khu</th><th>Doanh thu</th></tr></thead><tbody>${areas||'<tr><td colspan="2">Chưa có dữ liệu</td></tr>'}</tbody></table></div></div>`}
window.pages.users=async()=>{const u=await api('/api/users');$('#content').innerHTML=`<div class="grid2"><div class="panel"><div class="panel-head"><div><h3>Tạo tài khoản nhân sự</h3><span class="muted">Phân quyền Quản lý / Nhân viên</span></div></div><div class="form-grid"><label>Tài khoản<input id="newUser" placeholder="nhanvien01"></label><label>Mật khẩu<input id="newPass" type="password" placeholder="Tối thiểu 8 ký tự"></label><label>Họ tên<input id="newName" placeholder="Nguyễn Văn A"></label><label>Vai trò<select id="newRole"><option value="staff">Nhân viên</option><option value="manager">Quản lý</option></select></label></div><button class="primary" id="createUser">+ Tạo tài khoản</button></div><div class="panel"><div class="panel-head"><h3>Tài khoản hệ thống</h3><span class="muted">${u.length} tài khoản</span></div><table class="table"><thead><tr><th>Tài khoản</th><th>Họ tên</th><th>Vai trò</th><th></th></tr></thead><tbody>${u.map(x=>`<tr><td><b>${x.username}</b></td><td>${x.full_name}</td><td><span class="pill ${x.role==='manager'?'green':''}">${x.role==='manager'?'Quản lý':'Nhân viên'}</span></td><td>${x.id===me.id?'<span class="muted">Đang dùng</span>':`<button class="btn danger del-user" data-id="${x.id}">Xóa</button>`}</td></tr>`).join('')}</tbody></table></div></div>`;$('#createUser').onclick=async()=>{try{await api('/api/users',{method:'POST',body:{username:$('#newUser').value,password:$('#newPass').value,full_name:$('#newName').value,role:$('#newRole').value}});toast('Đã tạo tài khoản');await pages.users()}catch(e){toast(e.message,'error')}};$$('.del-user').forEach(b=>b.onclick=async()=>{if(!confirm('Xóa tài khoản này?'))return;try{await api('/api/users/'+b.dataset.id,{method:'DELETE'});toast('Đã xóa tài khoản');await pages.users()}catch(e){toast(e.message,'error')}})}
window.pages.activity=async()=>{const log=await api('/api/activity?limit=100');$('#content').innerHTML=`<div class="panel"><div class="panel-head"><div><h3>Nhật ký hoạt động</h3><span class="muted">100 thao tác gần nhất · dữ liệu lưu trong PostgreSQL</span></div><span class="pill green">AUDIT LOG</span></div><div class="activity-list">${log.length?log.map(activityItem).join(''):'<div class="empty-state">Chưa có dữ liệu</div>'}</div></div>`}
window.pages.monthly=async()=>{const rows=await api('/api/monthly');$('#content').innerHTML=`<div class="grid2"><div class="panel"><div class="panel-head"><div><h3>Vé tháng</h3><span class="muted">Quản lý khách gửi xe dài hạn</span></div></div><div class="form-grid"><label>Biển số<input id="mpPlate" autocomplete="off" placeholder="29B1-123.45"></label><label>Loại xe<select id="mpType"><option>Xe máy</option><option>Ô tô</option></select></label><label>Khách hàng<input id="mpName" placeholder="Nguyễn Văn A"></label><label>Số điện thoại<input id="mpPhone" placeholder="09xxxxxxxx"></label><label>Số tháng<input id="mpMonths" type="number" min="1" max="12" value="1"></label><label>Giá/tháng<input id="mpPrice" type="number" min="0" value="150000"></label></div><button class="primary" id="createMonthly">+ Tạo vé tháng</button></div><div class="panel"><div class="panel-head"><h3>Danh sách vé</h3><span class="muted">${rows.length} vé</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Biển số</th><th>Khách</th><th>Loại</th><th>Hết hạn</th><th>Giá</th><th>Trạng thái</th></tr></thead><tbody>${rows.map(x=>`<tr><td><b>${formatPlate(x.license_plate)}</b></td><td>${x.customer_name}</td><td>${x.vehicle_type}</td><td>${dt(x.expires_at)}</td><td>${money(x.price)}</td><td><span class="pill ${x.expired?'red':'green'}">${x.expired?'HẾT HẠN':'CÒN HẠN'}</span></td></tr>`).join('')||'<tr><td colspan="6">Chưa có vé</td></tr>'}</tbody></table></div></div></div>`;bindVehicleTypeDetection('#mpPlate','#mpType');$('#createMonthly').onclick=async()=>{try{await api('/api/monthly',{method:'POST',body:{license_plate:formatPlate($('#mpPlate').value),vehicle_type:$('#mpType').value,customer_name:$('#mpName').value,phone:$('#mpPhone').value,months:+$('#mpMonths').value,price:+$('#mpPrice').value}});toast('Đã tạo vé tháng');await pages.monthly()}catch(e){toast(e.message,'error')}}}
window.pages['ai-center']=async()=>{const p=await api('/api/ai/prediction');$('#content').innerHTML=`<div class="cards"><div class="card"><div class="label">TỶ LỆ HIỆN TẠI</div><div class="metric">${p.occupancy_rate}%</div></div><div class="card"><div class="label">GIỜ CAO ĐIỂM</div><div class="metric">${p.peak_hour}</div></div><div class="card"><div class="label">DỰ BÁO ĐỈNH</div><div class="metric">${p.projected_peak_occupancy}%</div></div><div class="card"><div class="label">RỦI RO</div><div class="metric">${p.risk}</div></div></div><div class="panel"><div class="panel-head"><div><h3>🤖 AI Center · Dự báo vận hành</h3><span class="muted">Dữ liệu 7 ngày gần nhất</span></div><span class="pill ${p.risk==='Cao'?'red':'green'}">${p.risk.toUpperCase()}</span></div><div class="ai-box"><b>Khuyến nghị:</b><br>${p.recommendation}</div></div>`}
window.pages.settings=async()=>{const c=await api('/api/company');$('#content').innerHTML=`<div class="grid2"><div class="panel"><div class="panel-head"><div><h3>Thông tin doanh nghiệp</h3><span class="muted">Thông tin này sẽ xuất hiện trên biên lai</span></div></div><label>Tên doanh nghiệp<input id="companyName" value="${c.company_name.replace(/"/g,'&quot;')}"></label><label>Số điện thoại<input id="companyPhone" value="${c.phone.replace(/"/g,'&quot;')}"></label><label>Địa chỉ<input id="companyAddress" value="${c.address.replace(/"/g,'&quot;')}"></label><button class="primary" id="saveCompany">Lưu thông tin</button></div><div class="panel"><div class="panel-head"><div><h3>Bảo mật tài khoản</h3><span class="muted">Đổi mật khẩu tài khoản đang đăng nhập</span></div></div><label>Mật khẩu hiện tại<input id="oldPass" type="password"></label><label>Mật khẩu mới<input id="newPassword" type="password" placeholder="Tối thiểu 8 ký tự"></label><button class="primary" id="changePassword">Đổi mật khẩu</button><hr><div class="panel-head"><div><h3>Sao lưu dữ liệu</h3><span class="muted">Tải bản backup SQLite về máy</span></div></div><button class="btn" id="backupBtn">⇩ Tải backup database</button></div></div>`;$('#saveCompany').onclick=async()=>{try{await api('/api/company',{method:'PUT',body:{company_name:$('#companyName').value,phone:$('#companyPhone').value,address:$('#companyAddress').value}});toast('Đã lưu thông tin doanh nghiệp')}catch(e){toast(e.message,'error')}};$('#changePassword').onclick=async()=>{try{await api('/api/account/password',{method:'POST',body:{current_password:$('#oldPass').value,new_password:$('#newPassword').value}});toast('Đổi mật khẩu thành công');setTimeout(()=>{localStorage.removeItem('parking_token');location.reload()},900)}catch(e){toast(e.message,'error')}};$('#backupBtn').onclick=async()=>{try{await downloadBackup();toast('Đã tải backup database')}catch(e){toast(e.message,'error')}}}

boot();

// Premium UI helpers
(function(){
  const clockEl=document.getElementById('clock');
  const refresh=document.getElementById('refreshBtn');
  function tick(){if(clockEl) clockEl.textContent=new Date().toLocaleTimeString('vi-VN',{hour12:false});}
  tick(); setInterval(tick,1000);
  if(refresh) refresh.addEventListener('click',async()=>{
    refresh.style.transform='rotate(360deg)';
    setTimeout(()=>refresh.style.transform='',350);
    const active=document.querySelector('#nav button.active');
    const page=active?.dataset.page||'dashboard';
    if(window.pages?.[page]) await window.pages[page]();
    else if(typeof navigate==='function') await navigate(page);
  });
})();


// Ultra Premium v3 micro-interactions
(function(){
  document.addEventListener('click',function(e){
    const target=e.target.closest('.primary,.icon-btn,.sidebar nav button,.real-slot');
    if(!target || target.classList.contains('real-slot')===false && !target.matches('.primary,.icon-btn,.sidebar nav button')) return;
    const r=target.getBoundingClientRect(); const size=Math.max(r.width,r.height)*.55;
    const ripple=document.createElement('span'); ripple.className='ripple'; ripple.style.width=ripple.style.height=size+'px';
    ripple.style.left=(e.clientX-r.left-size/2)+'px'; ripple.style.top=(e.clientY-r.top-size/2)+'px';
    target.style.position='relative'; target.appendChild(ripple); setTimeout(()=>ripple.remove(),600);
  });
})();


// ===== ULTRA PREMIUM V4 EXPERIENCE =====
(function(){
  const body=document.body;
  const themeBtn=document.getElementById('themeToggle');
  const focusBtn=document.getElementById('focusBtn');
  const mobileMenu=document.getElementById('mobileMenu');
  const savedTheme=localStorage.getItem('parking_theme');
  if(savedTheme==='dark') body.classList.add('dark-mode');
  function syncTheme(){ if(themeBtn) themeBtn.textContent=body.classList.contains('dark-mode')?'☀':'☾'; }
  syncTheme();
  themeBtn?.addEventListener('click',()=>{
    body.classList.toggle('dark-mode');
    localStorage.setItem('parking_theme',body.classList.contains('dark-mode')?'dark':'light');
    syncTheme(); toast(body.classList.contains('dark-mode')?'Đã bật giao diện tối':'Đã bật giao diện sáng');
  });
  focusBtn?.addEventListener('click',()=>{
    document.querySelector('.main')?.classList.toggle('focus-mode');
    toast(document.querySelector('.main')?.classList.contains('focus-mode')?'Đã bật chế độ tập trung':'Đã tắt chế độ tập trung');
  });
  const sidebar=document.querySelector('.sidebar');
  const syncMobileNav=()=>{
    const open=sidebar?.classList.contains('mobile-open');
    document.body.classList.toggle('mobile-nav-open',!!open);
    if(mobileMenu) mobileMenu.setAttribute('aria-expanded',open?'true':'false');
  };
  mobileMenu?.setAttribute('aria-expanded','false');
  mobileMenu?.addEventListener('click',(e)=>{
    e.preventDefault();
    e.stopPropagation();
    if(!sidebar) return;
    const isOpen=sidebar.classList.toggle('mobile-open');
    document.body.classList.toggle('sidebar-open',isOpen);
    syncMobileNav();
  },{passive:false});
  document.addEventListener('click',async e=>{
    const navBtn=e.target.closest('.sidebar nav button, .mobile-bottom-nav button');
    if(navBtn && window.innerWidth<=760){
      const page=navBtn.dataset.page;
      if(page && typeof navigate==='function') await navigate(page);
      sidebar?.classList.remove('mobile-open');
      document.body.classList.remove('sidebar-open');
      syncMobileNav();
      return;
    }
    if(window.innerWidth<=760 && sidebar?.classList.contains('mobile-open') &&
       !e.target.closest('.sidebar') && !e.target.closest('#mobileMenu')){
      sidebar.classList.remove('mobile-open');
      document.body.classList.remove('sidebar-open');
      syncMobileNav();
    }
  });
  window.addEventListener('resize',()=>{
    if(window.innerWidth>760){
      sidebar?.classList.remove('mobile-open');
      document.body.classList.remove('sidebar-open');
      syncMobileNav();
    }
  });
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){
      e.preventDefault(); $('#plate')?.focus() || $('#search')?.focus();
      toast('Đã chuyển đến ô nhập nhanh');
    }
    if(e.key==='Escape') document.querySelector('#slotModal:not(.hidden) .pay-close, #slotModal:not(.hidden) .slot-close')?.click();
  });
  // Subtle page entrance animation whenever content is replaced.
  const content=document.getElementById('content');
  if(content){
    const observer=new MutationObserver(()=>{
      content.classList.remove('page-enter'); void content.offsetWidth; content.classList.add('page-enter');
    });
    observer.observe(content,{childList:true});
  }
})();


// QR ticket helper
document.addEventListener('click', async (e)=>{ const b=e.target.closest('.qr-ticket'); if(!b) return; try{ const d=await api('/api/ticket/qr/'+b.dataset.id); const w=window.open('','_blank'); w.document.write(`<html><head><title>Vé QR #${d.record_id}</title></head><body style="font-family:Arial;text-align:center;padding:30px"><h2>Vé gửi xe #${d.record_id}</h2><h3>${d.license_plate}</h3><p>${d.area} · ${d.slot}</p>${d.qr_data?`<img src="${d.qr_data}" width="260">`:`<pre>${d.qr_text||''}</pre>`}<p>${dt(d.time_in)}</p><button onclick="window.print()">In vé</button></body></html>`); w.document.close(); }catch(err){toast(err.message,'error')} });

// Global plate formatter: works for both main "add vehicle" and slot quick-add inputs.
document.addEventListener("input", function(e){
  const el=e.target;
  if(!el || el.tagName!=="INPUT") return;
  const name=(el.name||el.id||"").toLowerCase();
  const isPlate=name.includes("plate") || name.includes("license") || name.includes("bien");
  if(!isPlate) return;

  // Do NOT insert punctuation while the user is still entering the plate.
  // Keep only letters/numbers, uppercase them, and detect vehicle type.
  // Formatting is applied on blur / submit so "30A" never becomes "330A".
  const raw=String(el.value||"");
  const clean=raw.toUpperCase().replace(/[^A-Z0-9]/g,"");
  if(raw!==clean){
    el.value=clean;
    try{ el.setSelectionRange(el.value.length,el.value.length); }catch(_){}
  }

  const form=el.closest("form") || document;
  const typeSelect=form.querySelector('select[name*="vehicle"],select[name*="type"],#vehicleType,#addVehicleType');
  if(typeSelect){
    const t=detectVehicleType(clean);
    if(clean.length>=5){
      typeSelect.value=t;
      typeSelect.dispatchEvent(new Event("change",{bubbles:true}));
    }
  }
});

document.addEventListener("blur", function(e){
  const el=e.target;
  if(!el || el.tagName!=="INPUT") return;
  const name=(el.name||el.id||"").toLowerCase();
  const isPlate=name.includes("plate") || name.includes("license") || name.includes("bien");
  if(!isPlate) return;
  const formatted=normalizePlate(el.value);
  if(formatted) el.value=formatted;
}, true);



document.addEventListener("submit", function(e){
  const form=e.target;
  if(!form) return;
  const plates=form.querySelectorAll('input[name*="plate"],input[name*="license"],input[id*="plate"],input[id*="license"],input[id*="bien"]');
  plates.forEach(el=>{
    const formatted=normalizePlate(el.value);
    if(formatted) el.value=formatted;
  });
}, true);


/* ===== Mobile sidebar touch controller ===== */
(function(){
  const getSidebar=()=>document.querySelector(".sidebar,#sidebar,.app-sidebar");
  const getBackdrop=()=>document.querySelector(".sidebar-backdrop,.mobile-sidebar-backdrop");
  const open=()=>{
    const sb=getSidebar(), bd=getBackdrop();
    if(sb) sb.classList.add("open","active");
    if(bd) bd.classList.add("show","active");
    document.body.classList.add("sidebar-open");
  };
  const close=()=>{
    const sb=getSidebar(), bd=getBackdrop();
    if(sb) sb.classList.remove("open","active");
    if(bd) bd.classList.remove("show","active");
    document.body.classList.remove("sidebar-open");
  };
  document.addEventListener("click",e=>{
    const t=e.target.closest?.(".sidebar-toggle,.menu-toggle,#sidebarToggle,[data-sidebar-toggle]");
    if(t){ e.preventDefault(); e.stopPropagation(); const sb=getSidebar(); if(sb?.classList.contains("open")||sb?.classList.contains("active")||document.body.classList.contains("sidebar-open")) close(); else open(); return; }
    if(e.target.closest?.(".sidebar-backdrop,.mobile-sidebar-backdrop")) close();
    if(e.target.closest?.(".sidebar a,.sidebar button,.sidebar .nav-item,.sidebar .nav-link")) close();
  },true);
  document.addEventListener("keydown",e=>{if(e.key==="Escape") close();});
})();
