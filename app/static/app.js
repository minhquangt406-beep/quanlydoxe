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

const titles={dashboard:"Tổng quan",parking:"Xe vào / Xe ra",slots:"Vị trí đỗ",history:"Lịch sử",vehicles:"Phương tiện",pricing:"Bảng giá",areas:"Khu vực",ai:"AI phân tích",reports:"Báo cáo doanh thu",users:"Tài khoản",settings:"Cài đặt doanh nghiệp"};
async function api(path,opt={}){opt.headers={...(opt.headers||{}),...(token?{Authorization:"Bearer "+token}:{})};if(opt.body&&typeof opt.body!=="string"){opt.headers["Content-Type"]="application/json";opt.body=JSON.stringify(opt.body)}const r=await fetch(path,opt);const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.detail||"Có lỗi xảy ra");return data}
function money(n){return Number(n||0).toLocaleString("vi-VN")+" ₫"} function dt(s){return s?new Date(s).toLocaleString("vi-VN"):"—"}
function toast(msg,type="success"){const el=$("#toast");if(!el)return;el.textContent=msg;el.className="toast show "+type;clearTimeout(window.__toast);window.__toast=setTimeout(()=>el.className="toast",2600)}
const vehicleTypes=["Xe máy","Ô tô","Xe đạp"];
// Tự nhận diện loại xe theo cấu trúc biển số.
const detectVehicleType = (rawPlate) => {
  const plate=String(rawPlate||"").toUpperCase().trim().replace(/\s+/g,"");
  if(!plate) return null;
  // Xe máy theo quy ước của hệ thống: 29B1-123.45, 29AD-123.45 và dạng tương tự.
  if(/^\d{2}[A-Z]{1,2}\d-?\d{3}\.?\d{2}$/.test(plate)) return "Xe máy";
  if(/^\d{2}[A-Z]{1,2}\d\d{5}$/.test(plate)) return "Xe máy";
  // Ô tô: dạng 29A-123.45 / 29A12345.
  if(/^\d{2}[A-Z]-?\d{4,5}(?:\.\d{2})?$/.test(plate)) return "Ô tô";
  return null;
};
const bindVehicleTypeDetection=(plateSelector,typeSelector)=>{
  const plateInput=$(plateSelector), typeSelect=$(typeSelector);
  if(!plateInput||!typeSelect||plateInput.dataset.typeDetectionBound) return;
  plateInput.dataset.typeDetectionBound="1";
  const update=()=>{const detected=detectVehicleType(plateInput.value);if(detected)typeSelect.value=detected;};
  ["input","change","blur"].forEach(ev=>plateInput.addEventListener(ev,update));
};

function openSlotModal(slot){
  const m=$("#slotModal"),b=$("#modalBody");
  if(!m||!b)return;
  const occupied=slot.status==="occupied";
  b.innerHTML=`
    <div class="eyebrow">PARKING SLOT DETAILS</div>
    <h3 class="modal-title">${slot.name}</h3>
    <div class="modal-sub">${slot.area_name} · Vị trí được chọn trên bản đồ bãi xe</div>
    ${occupied
      ? `<div class="modal-occupied">● ĐANG SỬ DỤNG · ${slot.license_plate||"Chưa có biển số"}</div>`
      : `<div class="modal-empty">✓ VỊ TRÍ ĐANG SẴN SÀNG · Có thể thêm xe trực tiếp tại đây</div>`}
    <div class="detail-grid">
      <div class="detail-item"><span>Biển số</span><b>${slot.license_plate||"—"}</b></div>
      <div class="detail-item"><span>Loại xe</span><b>${slot.vehicle_type||"—"}</b></div>
      <div class="detail-item"><span>Khu vực</span><b>${slot.area_name}</b></div>
      <div class="detail-item"><span>Trạng thái</span><b>${occupied?"Đang sử dụng":"Sẵn sàng"}</b></div>
      ${occupied?`<div class="detail-item"><span>Thời gian vào</span><b>${dt(slot.time_in)}</b></div>`:""}
    </div>
    ${!occupied?`
      <div class="quick-checkin">
        <div class="quick-title">🚗 THÊM XE TRỰC TIẾP</div>
        <div class="quick-sub">Không cần chuyển sang màn hình “Xe vào / Xe ra”</div>
        <div class="quick-form-grid">
          <label>Biển số xe<input id="quickPlate" autocomplete="off" placeholder="Ví dụ: 30A-123.45"></label>
          <label>Loại xe<select id="quickVtype">${vehicleTypes.map(v=>`<option value="${v}">${v}</option>`).join("")}</select></label>
        </div>
      </div>`:""}
    <div class="modal-actions">
      ${occupied
        ? `<button class="primary" id="modalCheckout">Tính phí & xe ra</button>`
        : `<button class="btn" id="modalCancelCheckin">Hủy</button><button class="primary" id="modalCheckin">🚗 Thêm xe vào ${slot.name}</button>`}
    </div>`;
  m.classList.remove("hidden");
  bindVehicleTypeDetection("#quickPlate","#quickVtype");
  const close=()=>m.classList.add("hidden");
  $("#modalClose").onclick=close;
  $(".modal-backdrop").onclick=close;
  if(occupied){
    $("#modalCheckout").onclick=async()=>{
      try{
        const active=await api("/api/active");
        const row=active.find(x=>x.slot===slot.name);
        if(!row)throw new Error("Không tìm thấy lượt gửi đang hoạt động");
        const d=await api("/api/checkout",{method:"POST",body:{record_id:row.id}});
        close();
        toast(`Đã cho ${slot.license_plate} ra bãi · ${money(d.fee)}`);
        await navigate("dashboard");
      }catch(e){toast(e.message,"error")}
    };
  }else{
    $("#modalCancelCheckin").onclick=close;
    const plateInput=$("#quickPlate");
    const submit=async()=>{
      const plate=plateInput?.value?.trim();
      const vehicleType=$("#quickVtype")?.value||"Xe máy";
      if(!plate){toast("Vui lòng nhập biển số xe","error");plateInput?.focus();return;}
      const btn=$("#modalCheckin");
      if(btn){btn.disabled=true;btn.textContent="Đang thêm xe...";}
      try{
        const d=await api("/api/checkin",{method:"POST",body:{license_plate:plate,vehicle_type:vehicleType,slot_id:Number(slot.id)}});
        close();
        toast(`✓ ${plate} đã vào ${slot.name}`);
        await navigate("dashboard");
      }catch(e){
        toast(e.message,"error");
        if(btn){btn.disabled=false;btn.textContent=`🚗 Thêm xe vào ${slot.name}`;}
      }
    };
    $("#modalCheckin").onclick=submit;
    plateInput?.addEventListener("keydown",e=>{if(e.key==="Enter")submit()});
    setTimeout(()=>plateInput?.focus(),80);
  }
}
function wireMapInteractions(){const s=window.__latestSlots||[];$$('.real-slot').forEach(el=>el.onclick=()=>{const x=s.find(v=>String(v.id)===el.dataset.slotId);if(x)openSlotModal(x)});$$('.map-zone').forEach(z=>z.onclick=e=>{if(e.target.closest('.real-slot'))return;$$('.map-zone').forEach(v=>v.classList.remove('zone-focus'));z.classList.add('zone-focus');setTimeout(()=>z.classList.remove('zone-focus'),900);toast(`Đã chọn ${z.querySelector('.zone-chip')?.textContent||"khu vực"}`)});}
async function boot(){if(!token)return;try{me=await api("/api/me");$("#loginView").classList.add("hidden");$("#appView").classList.remove("hidden");$("#userName").textContent=me.full_name;$("#userRole").textContent=me.role==="manager"?"Quản lý":"Nhân viên";$("#avatar").textContent=me.full_name[0];$$(".manager-only").forEach(x=>x.style.display=me.role==="manager"?"flex":"none");await navigate("dashboard")}catch(e){clearAuth()}}
$("#loginForm").onsubmit=async e=>{e.preventDefault();$("#loginError").textContent="";try{let d=await api("/api/auth/login",{method:"POST",body:{username:$("#username").value,password:$("#password").value}});token=d.access_token;localStorage.setItem("parking_token",token);refreshLastSeen();await boot()}catch(e){$("#loginError").textContent=e.message}};
$("#logout").onclick=()=>{clearAuth();location.reload()};
$("#nav").onclick=e=>{let b=e.target.closest("button[data-page]");if(b)navigate(b.dataset.page)};
async function navigate(page){$$("[data-page]").forEach(x=>x.classList.toggle("active",x.dataset.page===page));$("#pageTitle").textContent=titles[page];try{await pages[page]();if(page==="dashboard"||page==="slots")wireMapInteractions()}catch(e){$("#content").innerHTML=`<div class="panel"><b>Lỗi:</b> ${e.message}</div>`}}
async function renderSlots(){let s=await api("/api/slots");return s.map(x=>`<div class="slot ${x.status}">${x.name}<br><small>${x.status==="empty"?"TRỐNG":"ĐANG DÙNG"}</small></div>`).join("")}
async function downloadBackup(){const r=await fetch('/api/backup',{headers:{Authorization:'Bearer '+token}});if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.detail||'Không thể sao lưu');}const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='parking-backup-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.db';a.click();URL.revokeObjectURL(url)}
async function openReceipt(id){const r=await fetch('/api/receipt/'+id,{headers:{Authorization:'Bearer '+token}});if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.detail||'Không thể tạo biên lai');}const blob=await r.blob();const url=URL.createObjectURL(blob);window.open(url,'_blank');setTimeout(()=>URL.revokeObjectURL(url),60000)}

window.pages={
dashboard:async()=>{let d=await api("/api/dashboard"),s=await api("/api/slots"),a=await api("/api/active");window.__latestSlots=s;
const areas=[...new Map(s.map(x=>[x.area_id,{id:x.area_id,name:x.area_name,slots:[]}])).values()]; s.forEach(x=>areas.find(ar=>ar.id===x.area_id)?.slots.push(x));
const zone=(ar)=>{const occupied=ar.slots.filter(x=>x.status==="occupied").length,empty=ar.slots.length-occupied; const cls=ar.name.toLowerCase().includes("b")?"zone-b":"zone-a"; return `<div class="map-zone ${cls}" data-area-id="${ar.id}"><div class="zone-title"><div><span class="zone-chip">${ar.name.toUpperCase()}</span><h3>${ar.name} · Sơ đồ bãi</h3><span class="muted">${ar.slots.length} vị trí · ${empty} trống · ${occupied} đang dùng</span></div><span class="pill ${empty?"green":"red"}">${empty?"CÒN CHỖ":"ĐẦY"}</span></div><div class="real-slot-grid">${ar.slots.map(x=>`<div class="real-slot ${x.status}" data-slot-id="${x.id}" data-area-id="${ar.id}"><div class="slot-top"><span>${x.name}</span><span>${x.vehicle_type||"—"}</span></div><div class="slot-icon">${x.status==="occupied"?"🚗":"▱"}</div>${x.status==="occupied"?`<span class="plate">${x.license_plate||"NO PLATE"}</span>`:`<span class="slot-status">CHỖ TRỐNG</span>`}<span class="slot-status">${x.status==="occupied"?"ĐANG SỬ DỤNG":"SẴN SÀNG"}</span></div>`).join("")}</div></div>`};
const maps=areas.map(zone).join("");
$("#content").innerHTML=`<div class="cards"><div class="card"><div class="label">XE ĐANG GỬI</div><div class="metric">${d.active_vehicles}</div><div class="trend">● Đang vận hành</div></div><div class="card"><div class="label">CHỖ TRỐNG</div><div class="metric">${d.empty}</div><div class="trend">${d.total_slots} tổng vị trí</div></div><div class="card"><div class="label">TỶ LỆ LẤP ĐẦY</div><div class="metric">${d.occupancy_rate}%</div><div class="trend">Theo dữ liệu thực tế</div></div><div class="card"><div class="label">DOANH THU</div><div class="metric">${money(d.revenue)}</div><div class="trend">${d.closed_records} lượt hoàn tất</div></div><div class="card"><div class="label">GIỜ CAO ĐIỂM</div><div class="metric" style="font-size:21px">${d.peak_hour}</div><div class="trend">AI có thể phân tích</div></div></div>
<div class="panel area-overview"><div class="panel-head"><div><h3>Bản đồ bãi xe thực tế</h3><span class="muted">Biển số hiển thị trực tiếp trên ô đang đỗ</span></div><span class="pill green">LIVE MAP</span></div><div class="parking-map">${maps}<div class="map-legend"><span><i class="legend-dot legend-empty"></i>Trống</span><span><i class="legend-dot legend-occupied"></i>Đang đỗ</span></div></div></div>
<div class="panel active-panel"><div class="panel-head"><h3>Xe đang trong bãi</h3><span class="muted">${a.length} xe</span></div>${a.length?a.slice(0,10).map(x=>`<div style="display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)"><b>${x.license_plate}</b><span class="muted">${x.slot} · ${dt(x.time_in)}</span></div>`).join(""):`<div class="empty-state">Chưa có xe đang gửi</div>`}</div>`;wireMapInteractions()},
parking:async()=>{let slots=await api("/api/slots"),active=await api("/api/active");$("#content").innerHTML=`
<div class="grid2"><div class="panel"><div class="panel-head"><div><h3>Cho xe vào</h3><span class="muted">Chọn khu trước, sau đó chọn vị trí</span></div><span class="pill green">A / B</span></div><div class="form-grid"><label>Biển số<input id="plate" placeholder="29A-123.45"></label><label>Loại xe<select id="vtype"><option>Xe máy</option><option>Ô tô</option><option>Xe đạp</option></select></label><label>Khu vực<select id="areaFilter"><option value="all">Tất cả khu</option>${[...new Map(slots.map(x=>[x.area_id,x.area_name]))].map(([id,name])=>`<option value="${id}">${name}</option>`).join("")}</select></label><label>Vị trí<select id="slot">${slots.filter(x=>x.status==="empty").map(x=>`<option value="${x.id}" data-area="${x.area_id}">${x.area_name} · ${x.name}</option>`).join("")}</select></label></div><button class="primary" id="checkin" style="margin-top:14px">+ Cho xe vào</button><div id="parkingMsg"></div></div>
<div class="panel"><div class="panel-head"><h3>Xe đang gửi</h3><span class="muted">${active.length} xe</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Mã</th><th>Biển số</th><th>Vị trí</th><th>Thời gian</th><th></th></tr></thead><tbody>${active.map(x=>`<tr><td>#${x.id}</td><td><b>${x.license_plate}</b></td><td>${x.slot}</td><td>${dt(x.time_in)}</td><td><button class="btn checkout" data-id="${x.id}">Tính phí & xe ra</button></td></tr>`).join("")||`<tr><td colspan="5" class="empty-state">Không có xe</td></tr>`}</tbody></table></div></div></div>`;
bindVehicleTypeDetection("#plate","#vtype");$("#checkin").onclick=async()=>{try{let d=await api("/api/checkin",{method:"POST",body:{license_plate:$("#plate").value,vehicle_type:$("#vtype").value,slot_id:+$("#slot").value}});$("#parkingMsg").innerHTML=`<div class="notice">✓ ${d.message} · Mã lượt <b>#${d.record_id}</b> · ${d.slot}</div>`;await pages.parking()}catch(e){$("#parkingMsg").innerHTML=`<div class="error">${e.message}</div>`}};
$("#areaFilter").onchange=()=>{const area=$("#areaFilter").value; $$("#slot option").forEach(o=>o.hidden=area!=="all" && o.dataset.area!==area); const first=$$("#slot option").find(o=>!o.hidden); if(first) $("#slot").value=first.value;};
$$(".checkout").forEach(b=>b.onclick=async()=>{if(!confirm("Xác nhận cho xe ra?"))return;try{let d=await api("/api/checkout",{method:"POST",body:{record_id:+b.dataset.id}});alert(`Phí: ${money(d.fee)}\\nThời gian: ${d.hours} giờ`);await pages.parking()}catch(e){alert(e.message)}})},
slots:async()=>{let s=await api("/api/slots");window.__latestSlots=s; const areas=[...new Map(s.map(x=>[x.area_id,{id:x.area_id,name:x.area_name,slots:[]}])).values()]; s.forEach(x=>areas.find(ar=>ar.id===x.area_id)?.slots.push(x)); const zone=(ar)=>{const occupied=ar.slots.filter(x=>x.status==="occupied").length,empty=ar.slots.length-occupied;const cls=ar.name.toLowerCase().includes("b")?"zone-b":"zone-a";return `<div class="panel area-panel-large"><div class="parking-map"><div class="map-zone ${cls}" data-area-id="${ar.id}"><div class="zone-title"><div><span class="zone-chip">${ar.name.toUpperCase()}</span><h3>${ar.name} · Sơ đồ vị trí</h3><span class="muted">${ar.slots.length} vị trí · ${empty} trống · ${occupied} đang dùng</span></div><span class="pill ${empty?"green":"red"}">${empty?"CÒN CHỖ":"ĐẦY"}</span></div><div class="real-slot-grid">${ar.slots.map(x=>`<div class="real-slot ${x.status}" data-slot-id="${x.id}" data-area-id="${ar.id}"><div class="slot-top"><span>${x.name}</span><span>${x.vehicle_type||"—"}</span></div><div class="slot-icon">${x.status==="occupied"?"🚗":"▱"}</div>${x.status==="occupied"?`<span class="plate">${x.license_plate||"NO PLATE"}</span>`:`<span class="slot-status">CHỖ TRỐNG</span>`}<span class="slot-status">${x.status==="occupied"?"ĐANG SỬ DỤNG":"SẴN SÀNG"}</span></div>`).join("")}</div></div></div></div>`}; $("#content").innerHTML=`<div class="notice">Bản đồ được chia riêng theo từng khu. <b>Biển số</b> nằm ngay trên ô đang sử dụng.</div><div class="area-list">${areas.map(zone).join("")}</div>`},
history:async()=>{let h=await api("/api/history");const rowHtml=row=>`<tr><td>#${row.id}</td><td><b>${row.license_plate}</b></td><td>${row.vehicle_type}</td><td>${row.slot}</td><td>${dt(row.time_in)}</td><td>${dt(row.time_out)}</td><td>${row.fee?money(row.fee):"—"}</td><td><span class="pill ${row.time_out?"green":"red"}">${row.time_out?"Đã ra":"Đang gửi"}</span></td>${me?.role==="manager"?`<td><button class="btn danger delete-history" data-id="${row.id}">🗑 Xóa</button></td>`:""}</tr>`;const render=x=>x.map(rowHtml).join("");$("#content").innerHTML=`<div class="panel"><div class="panel-head"><h3>Lịch sử lượt gửi</h3><input id="search" style="width:240px;margin:0" placeholder="Tìm biển số, mã lượt..."></div><div class="table-wrap"><table class="table"><thead><tr><th>Mã</th><th>Biển số</th><th>Loại</th><th>Vị trí</th><th>Vào</th><th>Ra</th><th>Phí</th><th>Trạng thái</th>${me?.role==="manager"?"<th></th>":""}</tr></thead><tbody id="hist">${render(h)}</tbody></table></div></div>`;const bindDelete=()=>$$('.delete-history').forEach(b=>b.onclick=async()=>{if(!confirm(`Xóa lượt #${b.dataset.id}?\n\nDữ liệu lượt gửi này sẽ bị xóa khỏi lịch sử.`))return;try{const d=await api(`/api/history/${b.dataset.id}`,{method:"DELETE"});toast(d.message);await pages.history()}catch(e){toast(e.message,"error")}});bindDelete();$("#search").oninput=async()=>{let x=await api("/api/history?q="+encodeURIComponent($("#search").value));$("#hist").innerHTML=render(x);bindDelete()}},
vehicles:async()=>{let v=await api("/api/vehicles");$("#content").innerHTML=`<div class="panel"><div class="panel-head"><h3>Danh sách phương tiện</h3><span class="muted">${v.length} phương tiện</span></div><table class="table"><thead><tr><th>ID</th><th>Biển số</th><th>Loại xe</th>${me?.role==="manager"?"<th></th>":""}</tr></thead><tbody>${v.map(x=>`<tr><td>${x.id}</td><td><b>${x.license_plate}</b></td><td>${x.vehicle_type}</td>${me?.role==="manager"?`<td><button class="btn danger delete-vehicle" data-id="${x.id}" data-plate="${x.license_plate}">🗑 Xóa xe</button></td>`:""}</tr>`).join("")}</tbody></table></div>`;$$('.delete-vehicle').forEach(b=>b.onclick=async()=>{if(!confirm(`Xóa xe ${b.dataset.plate}?\n\nToàn bộ lịch sử của xe này cũng sẽ bị xóa.`))return;try{const d=await api(`/api/vehicles/${b.dataset.id}`,{method:"DELETE"});toast(d.message);await pages.vehicles();await pages.dashboard()}catch(e){toast(e.message,"error")}})},
pricing:async()=>{let p=await api("/api/pricing");$("#content").innerHTML=`<div class="panel"><div class="panel-head"><h3>Bảng giá</h3><span class="muted">Quản lý mức phí theo giờ</span></div><div class="form-grid"><label>Loại xe<select id="ptype"><option>Xe máy</option><option>Ô tô</option><option>Xe đạp</option></select></label><label>Giá / giờ<input id="price" type="number" min="0" placeholder="5000"></label><button class="primary" id="savePrice">Lưu bảng giá</button></div><table class="table" style="margin-top:20px"><thead><tr><th>Loại xe</th><th>Giá/giờ</th></tr></thead><tbody>${p.map(x=>`<tr><td>${x.vehicle_type}</td><td><b>${money(x.price_per_hour)}</b></td></tr>`).join("")}</tbody></table></div>`;$("#savePrice").onclick=async()=>{await api("/api/pricing",{method:"POST",body:{vehicle_type:$("#ptype").value,price_per_hour:+$("#price").value}});await pages.pricing()}},
areas:async()=>{let a=await api("/api/areas");$("#content").innerHTML=`<div class="panel"><div class="panel-head"><div><h3>Khu vực bãi xe</h3><span class="muted">Quản lý, thêm hoặc xóa từng khu</span></div><span class="pill green">${a.length} KHU</span></div><div class="form-grid"><label>Tên khu vực<input id="aname" placeholder="Khu C"></label><label>Sức chứa<input id="acap" type="number" min="1" value="10"></label><button class="primary" id="addArea">+ Tạo khu vực</button></div><div class="area-admin-grid" style="margin-top:20px">${a.map(x=>`<div class="card area-admin-card"><div class="area-admin-head"><div><span class="zone-chip">${x.name.toUpperCase()}</span><b class="area-admin-name">${x.name}</b></div><button class="btn danger delete-area" data-id="${x.id}" data-name="${x.name}">🗑 Xóa khu</button></div><div class="metric">${x.empty}<small style="font-size:12px;color:var(--muted)"> / ${x.capacity} trống</small></div><span class="muted">${x.occupied} đang sử dụng</span><div class="area-progress"><span style="width:${x.capacity?Math.min(100,(x.occupied/x.capacity)*100):0}%"></span></div>${x.occupied?`<div class="click-hint">⚠ Khu đang có xe — chưa thể xóa</div>`:`<div class="click-hint">Có thể xóa nếu chưa có lịch sử gửi xe</div>`}</div>`).join("")}</div></div>`;$("#addArea").onclick=async()=>{try{await api("/api/areas",{method:"POST",body:{name:$("#aname").value,capacity:+$("#acap").value}});await pages.areas()}catch(e){toast(e.message,"error")}};$$('.delete-area').forEach(btn=>btn.onclick=async()=>{const name=btn.dataset.name;if(!confirm(`Xóa ${name}?\n\nKhu chỉ được xóa khi không có xe và chưa có lịch sử gửi xe.`))return;try{const d=await api(`/api/areas/${btn.dataset.id}`,{method:"DELETE"});toast(d.message,"success");await pages.areas();await pages.dashboard()}catch(e){toast(e.message,"error")}})},
ai:async()=>{$("#content").innerHTML=`<div class="grid2"><div class="panel"><div class="panel-head"><h3>Trợ lý AI vận hành</h3><span class="pill green">LIVE DATA</span></div><div class="notice">AI chỉ phân tích dữ liệu thực tế từ database. AI sử dụng DeepSeek để phân tích dữ liệu bãi xe và có thể chuyển sang phân tích cục bộ khi API chưa sẵn sàng.</div><label>Câu hỏi quản lý<textarea id="question" style="width:100%;min-height:120px;border:1px solid var(--line);border-radius:12px;padding:13px" placeholder="Khung giờ nào đông nhất và nên bố trí nhân sự thế nào?"></textarea></label><button class="primary" id="ask">✦ Phân tích ngay</button></div><div class="panel"><div class="panel-head"><h3>Kết quả phân tích</h3></div><div id="aiResult" class="ai-box">Đang chờ câu hỏi...</div></div></div>`;$("#ask").onclick=async()=>{let q=$("#question").value;$("#aiResult").textContent="AI đang phân tích dữ liệu...";try{let d=await api("/api/ai",{method:"POST",body:{question:q}});$("#aiResult").textContent=d.answer+`\\n\\n[Chế độ: ${d.mode}]`}catch(e){$("#aiResult").textContent=e.message}}}
};

window.pages.reports=async()=>{const d=await api('/api/reports?days=30');const daily=Object.entries(d.daily).sort((a,b)=>a[0].localeCompare(b[0]));const max=Math.max(1,...daily.map(x=>x[1]));const bars=daily.slice(-14).map(([day,val])=>`<div class="report-bar-row"><span>${day.slice(5)}</span><div class="report-bar"><i style="width:${Math.max(2,val/max*100)}%"></i></div><b>${money(val)}</b></div>`).join('');const areas=Object.entries(d.by_area).sort((a,b)=>b[1]-a[1]).map(([name,val])=>`<tr><td>${name}</td><td><b>${money(val)}</b></td></tr>`).join('');$('#content').innerHTML=`<div class="cards"><div class="card"><div class="label">DOANH THU 30 NGÀY</div><div class="metric">${money(d.total_revenue)}</div><div class="trend">Theo lượt đã hoàn tất</div></div><div class="card"><div class="label">LƯỢT ĐÃ THANH TOÁN</div><div class="metric">${d.closed_records}</div><div class="trend">Trong 30 ngày gần nhất</div></div></div><div class="grid2"><div class="panel"><div class="panel-head"><div><h3>Doanh thu theo ngày</h3><span class="muted">14 ngày gần nhất có dữ liệu</span></div><span class="pill green">BUSINESS</span></div><div class="report-bars">${bars||'<div class="empty-state">Chưa có dữ liệu doanh thu</div>'}</div></div><div class="panel"><div class="panel-head"><h3>Doanh thu theo khu</h3></div><table class="table"><thead><tr><th>Khu</th><th>Doanh thu</th></tr></thead><tbody>${areas||'<tr><td colspan="2">Chưa có dữ liệu</td></tr>'}</tbody></table></div></div>`}
window.pages.users=async()=>{const u=await api('/api/users');$('#content').innerHTML=`<div class="grid2"><div class="panel"><div class="panel-head"><div><h3>Tạo tài khoản nhân sự</h3><span class="muted">Phân quyền Quản lý / Nhân viên</span></div></div><div class="form-grid"><label>Tài khoản<input id="newUser" placeholder="nhanvien01"></label><label>Mật khẩu<input id="newPass" type="password" placeholder="Tối thiểu 8 ký tự"></label><label>Họ tên<input id="newName" placeholder="Nguyễn Văn A"></label><label>Vai trò<select id="newRole"><option value="staff">Nhân viên</option><option value="manager">Quản lý</option></select></label></div><button class="primary" id="createUser">+ Tạo tài khoản</button></div><div class="panel"><div class="panel-head"><h3>Tài khoản hệ thống</h3><span class="muted">${u.length} tài khoản</span></div><table class="table"><thead><tr><th>Tài khoản</th><th>Họ tên</th><th>Vai trò</th><th></th></tr></thead><tbody>${u.map(x=>`<tr><td><b>${x.username}</b></td><td>${x.full_name}</td><td><span class="pill ${x.role==='manager'?'green':''}">${x.role==='manager'?'Quản lý':'Nhân viên'}</span></td><td>${x.id===me.id?'<span class="muted">Đang dùng</span>':`<button class="btn danger del-user" data-id="${x.id}">Xóa</button>`}</td></tr>`).join('')}</tbody></table></div></div>`;$('#createUser').onclick=async()=>{try{await api('/api/users',{method:'POST',body:{username:$('#newUser').value,password:$('#newPass').value,full_name:$('#newName').value,role:$('#newRole').value}});toast('Đã tạo tài khoản');await pages.users()}catch(e){toast(e.message,'error')}};$$('.del-user').forEach(b=>b.onclick=async()=>{if(!confirm('Xóa tài khoản này?'))return;try{await api('/api/users/'+b.dataset.id,{method:'DELETE'});toast('Đã xóa tài khoản');await pages.users()}catch(e){toast(e.message,'error')}})}
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
  mobileMenu?.addEventListener('click',()=>{
    sidebar?.classList.toggle('mobile-open');
    syncMobileNav();
  });
  document.addEventListener('click',e=>{
    const navBtn=e.target.closest('.sidebar nav button');
    if(navBtn && window.innerWidth<=760){
      sidebar?.classList.remove('mobile-open');
      syncMobileNav();
      return;
    }
    if(window.innerWidth<=760 && sidebar?.classList.contains('mobile-open') &&
       !e.target.closest('.sidebar') && !e.target.closest('#mobileMenu')){
      sidebar.classList.remove('mobile-open');
      syncMobileNav();
    }
  });
  window.addEventListener('resize',()=>{
    if(window.innerWidth>760){
      sidebar?.classList.remove('mobile-open');
      syncMobileNav();
    }
  });
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){
      e.preventDefault(); $('#plate')?.focus() || $('#search')?.focus();
      toast('Đã chuyển đến ô nhập nhanh');
    }
    if(e.key==='Escape') document.querySelector('#slotModal:not(.hidden) .modal-close')?.click();
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
