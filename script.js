// ================================================================
// KONFIGURASI — ganti sesuai deployment Apps Script kamu
// ================================================================
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbzCYs-AT1gTbkcGT0d7r7esmXsBCCj3gx7vRXLzX8YvFlEpa5a9vUPEUa-Bs8MMDdFp/exec';
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1Vj9l0PPAlALarPD01mXd5S64cUv3rk2pNCn0X3SuFD4/edit?gid=0#gid=0';

// ================================================================
// STATE
// ================================================================
const AppState = {
  scannerRunning:false, flashOn:false, isProcessing:false, html5QrCode:null,
  mahasiswaData:[], currentView:'home', debugMode:true
};

const DOM = {};
function cacheDOM(){
  ['statusDot','statusLabel','greetTitle','greetEyebrow','ringProgress','ringNum','hadirCount','totalCount',
   'todayDate','chipHadir','chipBelum','chipTotal','timelineList','lastScanList','scanStatusText',
   'btnStartScan','btnFlash','qrNimInput','qrPreview','qrResultImage','qrWho','qrSub','searchInput',
   'loadingData','dataListInner','confettiCanvas'
  ].forEach(id => DOM[id] = document.getElementById(id));
}

// Login frontend sederhana; key ini sengaja terpisah dari data presensi.
const LOGIN_STORAGE_KEY = 'presensiKelasLogin';

function isLoggedIn(){
  return localStorage.getItem(LOGIN_STORAGE_KEY) === 'true';
}

function showLogin(){
  document.getElementById('landingPage')?.classList.add('is-hidden');
  document.body.classList.add('login-visible');
  document.getElementById('loginScreen')?.classList.remove('is-hidden');
  document.getElementById('dashboardApp')?.classList.add('is-hidden');
}

function showLanding(){
  document.body.classList.remove('login-visible');
  document.getElementById('landingPage')?.classList.remove('is-hidden');
  document.getElementById('loginScreen')?.classList.add('is-hidden');
  document.getElementById('dashboardApp')?.classList.add('is-hidden');
}

function showDashboard(showWelcome=false){
  document.body.classList.remove('login-visible');
  document.getElementById('landingPage')?.classList.add('is-hidden');
  document.getElementById('loginScreen')?.classList.add('is-hidden');
  document.getElementById('dashboardApp')?.classList.remove('is-hidden');
  if(showWelcome) showToast('Selamat datang, Admin!', 'success');
}

function setupLogin(){
  const form = document.getElementById('loginForm');
  const passwordInput = document.getElementById('loginPassword');
  const toggle = document.getElementById('togglePassword');
  const error = document.getElementById('loginError');
  const remember = document.getElementById('rememberLogin');

  toggle?.addEventListener('click', () => {
    const visible = passwordInput.type === 'text';
    passwordInput.type = visible ? 'password' : 'text';
    toggle.innerHTML = `<i class="fas ${visible ? 'fa-eye' : 'fa-eye-slash'}"></i>`;
    toggle.setAttribute('aria-label', visible ? 'Tampilkan password' : 'Sembunyikan password');
  });

  form?.addEventListener('submit', event => {
    event.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = passwordInput.value;
    if(username === 'admin' && password === 'admin123'){
      if(remember.checked) localStorage.setItem(LOGIN_STORAGE_KEY, 'true');
      else sessionStorage.setItem(LOGIN_STORAGE_KEY, 'true');
      error.textContent = '';
      showDashboard(true);
      startApp();
      return;
    }
    error.textContent = 'Username atau password belum sesuai.';
    form.classList.remove('shake');
    requestAnimationFrame(() => form.classList.add('shake'));
  });
}

function logout(){
  if(!confirm('Keluar dari akun Admin?')) return;
  localStorage.removeItem(LOGIN_STORAGE_KEY);
  sessionStorage.removeItem(LOGIN_STORAGE_KEY);
  if(AppState.html5QrCode && AppState.scannerRunning) stopScanner();
  showLogin();
  document.getElementById('loginForm')?.reset();
  showToast('Anda telah keluar', 'info', 2200);
}

async function startApp(){
  if(AppState.started) return;
  AppState.started = true;
  renderHome();
  await loadDataMahasiswa();
  await syncPresensiHariIni(); 
  setInterval(loadDataMahasiswa, 30000);
  setInterval(syncPresensiHariIni, 15000); 
  await checkCameraPermission();
}

function log(...a){ if(AppState.debugMode) console.log('[Presensi]', ...a); }

async function syncPresensiHariIni(){
  try{
    const res = await fetch(`${WEB_APP_URL}?action=get_presensi_hari_ini`);
    const data = await res.json();
    if(!Array.isArray(data)) return;

    const map = {};
    data.forEach(item => {
      map[item.nim] = {
        date: todayKey(),
        time: item.waktu || '',
        nama: item.nama || '',
        kelas: item.kelas || '',
        jurusan: item.jurusan || '',
        ts: Date.now()
      };
    });
    setPresensiMap(map);
    renderHome();
    renderTimeline(DOM.lastScanList, getHistoryToday(), 5);
    renderDataList(DOM.searchInput ? DOM.searchInput.value : '');
  }catch(err){
    log('sync presensi error', err);
  }
}

// ================================================================
// VIEW SWITCHING
// ================================================================
function switchView(name){
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  AppState.currentView = name;
  if(name === 'scan' && !AppState.scannerRunning){ setTimeout(startScanner, 300); }
  if(name !== 'scan' && AppState.scannerRunning){ stopScanner(); }
}

// ================================================================
// TOASTS
// ================================================================
function showToast(message, type='info', duration=3200){
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  const icons = {success:'fa-circle-check', error:'fa-circle-exclamation', warning:'fa-triangle-exclamation', info:'fa-circle-info'};
  el.innerHTML = `<i class="fas ${icons[type]||icons.info}"></i><span>${message}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => { el.style.opacity='0'; el.style.transform='translateY(-8px)'; el.style.transition='.25s'; setTimeout(()=>el.remove(),250); }, duration);
}

// ================================================================
// CONFETTI (lightweight, no external lib)
// ================================================================
function burstConfetti(){
  const canvas = DOM.confettiCanvas;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const colors = ['#A8B89F','#F3EBDD','#8FAE83','#D8AD63','#8B6F47'];
  const pieces = Array.from({length:60}, () => ({
    x: canvas.width/2 + (Math.random()-0.5)*120,
    y: canvas.height*0.35,
    vx:(Math.random()-0.5)*9, vy:-Math.random()*9-4,
    size:Math.random()*6+4, color:colors[Math.floor(Math.random()*colors.length)],
    rot:Math.random()*360, vr:(Math.random()-0.5)*16, life:0
  }));
  let frame=0;
  function tick(){
    frame++;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    let alive=false;
    pieces.forEach(p=>{
      p.vy += 0.28; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life++;
      if(p.life < 90){ alive = true; }
      ctx.save();
      ctx.translate(p.x,p.y); ctx.rotate(p.rot*Math.PI/180);
      ctx.fillStyle = p.color; ctx.globalAlpha = Math.max(0, 1 - p.life/90);
      ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size*0.6);
      ctx.restore();
    });
    if(alive) requestAnimationFrame(tick); else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  tick();
}

function playChime(){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const notes = [880, 1108];
    notes.forEach((freq,i)=>{
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type='sine'; osc.frequency.value=freq;
      osc.connect(gain); gain.connect(ctx.destination);
      const t = ctx.currentTime + i*0.09;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t+0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t+0.32);
      osc.start(t); osc.stop(t+0.35);
    });
  }catch(e){}
}

// ================================================================
// KONEKSI
// ================================================================
function setConnectionStatus(status, message){
  DOM.statusDot.className = 'dot ' + status;
  DOM.statusLabel.textContent = message;
}

async function checkConnection(){
  setConnectionStatus('checking', 'Mengecek…');
  try{
    const controller = new AbortController();
    const timeoutId = setTimeout(()=>controller.abort(), 5000);
    const res = await fetch(WEB_APP_URL + '?action=ping', { signal:controller.signal, headers:{Accept:'application/json'} });
    clearTimeout(timeoutId);
    if(res.ok){ setConnectionStatus('online','Online'); return true; }
    throw new Error('no response');
  }catch(e){
    setConnectionStatus('offline','Offline'); return false;
  }
}

// ================================================================
// PRESENSI HARI INI (localStorage)
// ================================================================
function todayKey(){ return new Date().toLocaleDateString('id-ID'); }
function getPresensiMap(){ return JSON.parse(localStorage.getItem('presensiHariIni') || '{}'); }
function setPresensiMap(map){ localStorage.setItem('presensiHariIni', JSON.stringify(map)); }
function isHadirToday(nim){ return getPresensiMap()[nim]?.date === todayKey(); }

function getHistoryToday(){
  const map = getPresensiMap();
  const rows = Object.entries(map)
    .filter(([nim, v]) => v.date === todayKey())
    .map(([nim, v]) => ({ nim, ...v }))
    .sort((a,b) => (b.ts||0) - (a.ts||0));
  return rows;
}

function initials(name){
  if(!name) return '?';
  return name.trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();
}

// ================================================================
// RENDER: HOME DASHBOARD
// ================================================================
function renderHome(){
  const total = AppState.mahasiswaData.length;
  const history = getHistoryToday();
  const hadir = history.length;
  const pct = total ? Math.round((hadir/total)*100) : 0;

  DOM.hadirCount.textContent = hadir;
  DOM.totalCount.textContent = total;
  DOM.chipHadir.textContent = hadir;
  DOM.chipBelum.textContent = Math.max(total-hadir,0);
  DOM.chipTotal.textContent = total;
  DOM.ringNum.textContent = pct + '%';
  const circumference = 2*Math.PI*70;
  DOM.ringProgress.style.strokeDasharray = circumference;
  DOM.ringProgress.style.strokeDashoffset = circumference - (pct/100)*circumference;

  const now = new Date();
  DOM.todayDate.textContent = now.toLocaleDateString('id-ID', {weekday:'long', day:'numeric', month:'long'});
  const hour = now.getHours();
  DOM.greetTitle.textContent = (hour<11 ? 'Selamat pagi 👋' : hour<15 ? 'Selamat siang 👋' : hour<18 ? 'Selamat sore 👋' : 'Selamat malam 👋');

  renderTimeline(DOM.timelineList, history, 8);
}

function renderTimeline(container, history, limit){
  if(!history.length){
    container.innerHTML = '<div class="empty-note"><i class="fas fa-clock-rotate-left"></i>Belum ada presensi hari ini</div>';
    return;
  }
  container.innerHTML = history.slice(0, limit).map(h => `
    <div class="timeline-item">
      <div class="avatar-dot">${initials(h.nama)}</div>
      <div class="timeline-info">
        <div class="nm">${h.nama || h.nim}</div>
        <div class="meta">${h.kelas || '-'} · ${h.jurusan || '-'}</div>
      </div>
      <div class="timeline-time">${h.time || ''}</div>
    </div>
  `).join('');
}

// ================================================================
// RENDER: DATA LIST
// ================================================================
function renderDataList(filterText=''){
  const q = filterText.trim().toLowerCase();
  const rows = AppState.mahasiswaData.filter(m =>
    !q || (m.nama||'').toLowerCase().includes(q) || (m.nim||'').toLowerCase().includes(q)
  );
  if(!rows.length){
    DOM.dataListInner.innerHTML = '<div class="empty-note" style="padding:24px 4px;"><i class="fas fa-user-slash"></i>Tidak ada mahasiswa ditemukan</div>';
    return;
  }
  DOM.dataListInner.innerHTML = rows.map(m => {
    const hadir = isHadirToday(m.nim);
    return `
    <div class="stu-row">
      <div class="avatar-dot">${initials(m.nama)}</div>
      <div class="stu-info">
        <div class="nm">${m.nama || '-'}</div>
        <div class="meta">${m.nim || '-'} · ${m.kelas || '-'}</div>
      </div>
      <span class="badge ${hadir?'hadir':'belum'}">${hadir?'Hadir':'Belum'}</span>
    </div>`;
  }).join('');
}

function filterTable(){ renderDataList(DOM.searchInput.value); }

// ================================================================
// LOAD DATA MAHASISWA
// ================================================================
async function loadDataMahasiswa(){
  let hasCachedData = false;
  const cached = localStorage.getItem('mahasiswaData');
  if(cached){
    try{
      const parsed = JSON.parse(cached);
      if(Array.isArray(parsed) && parsed.length){
        hasCachedData = true;
        AppState.mahasiswaData = parsed;
        DOM.loadingData.style.display = 'none';
        DOM.dataListInner.style.display = 'block';
        renderDataList(DOM.searchInput ? DOM.searchInput.value : '');
        renderHome();
      }
    }catch(e){}
  }
  if(!hasCachedData){
    DOM.loadingData.style.display = 'block';
    DOM.dataListInner.style.display = 'none';
    DOM.loadingData.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Mengambil data…';
  }

  const applyData = (data, note) => {
    AppState.mahasiswaData = data;
    localStorage.setItem('mahasiswaData', JSON.stringify(data));
    DOM.loadingData.style.display = 'none';
    DOM.dataListInner.style.display = 'block';
    renderDataList(DOM.searchInput ? DOM.searchInput.value : '');
    renderHome();
    if(note) showToast(note, 'info', 2500);
  };

  try{
    const online = await checkConnection();
    if(!online){
      if(hasCachedData){
        return;
      }
      if(cached){
        try{ const parsed = JSON.parse(cached); if(parsed?.length){ applyData(parsed, `${parsed.length} data dari cache (offline)`); return; } }catch(e){}
      }
      DOM.loadingData.innerHTML = `
        <i class="fas fa-wifi" style="color:var(--coral);font-size:22px;display:block;margin-bottom:10px;"></i>
        <strong style="color:var(--coral);">Tidak ada koneksi</strong><br>
        <span style="color:var(--ink-faint);font-size:11.5px;">Dan tidak ada data cache tersimpan.</span><br><br>
        <button onclick="loadDataMahasiswa()" class="btn btn-main" style="display:inline-flex;padding:8px 16px;"><i class="fas fa-rotate"></i> Coba lagi</button>`;
      return;
    }

    const res = await fetch(WEB_APP_URL + '?action=get_all', { headers:{Accept:'application/json'}, signal:AbortSignal.timeout(15000) });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    if(Array.isArray(data) && data.length){
      applyData(data);
    } else {
      const cached = localStorage.getItem('mahasiswaData');
      if(cached){
        try{ const parsed = JSON.parse(cached); if(parsed?.length){ applyData(parsed, `${parsed.length} data dari cache`); return; } }catch(e){}
      }
      DOM.loadingData.innerHTML = `
        <i class="fas fa-circle-info" style="color:var(--amber);font-size:20px;display:block;margin-bottom:10px;"></i>
        <strong style="color:var(--amber);">Belum ada data di Google Sheets</strong><br>
        <span style="color:var(--ink-faint);font-size:11.5px;">Tambahkan data mahasiswa terlebih dahulu.</span><br><br>
        <a href="${SHEET_URL}" target="_blank" class="btn btn-main" style="display:inline-flex;padding:8px 16px;text-decoration:none;"><i class="fas fa-arrow-up-right-from-square"></i> Buka Sheet</a>`;
    }
  }catch(err){
    log('load error', err);
    if(hasCachedData) return;
    const cached = localStorage.getItem('mahasiswaData');
    if(cached){
      try{ const parsed = JSON.parse(cached); if(parsed?.length){ applyData(parsed, `${parsed.length} data dari cache (error)`); return; } }catch(e){}
    }
    DOM.loadingData.innerHTML = `
      <i class="fas fa-triangle-exclamation" style="color:var(--coral);font-size:22px;display:block;margin-bottom:10px;"></i>
      <strong style="color:var(--coral);">Gagal memuat data</strong><br>
      <span style="color:var(--ink-faint);font-size:11.5px;">${err.message}</span><br><br>
      <button onclick="loadDataMahasiswa()" class="btn btn-main" style="display:inline-flex;padding:8px 16px;"><i class="fas fa-rotate"></i> Coba lagi</button>`;
  }
}

// ================================================================
// GENERATE QR CODE PER MAHASISWA
// ================================================================
function generateQRCode(){
  const nim = DOM.qrNimInput.value.trim();
  if(!nim){ showToast('Masukkan NIM terlebih dahulu', 'error'); DOM.qrNimInput.focus(); return; }
  if(nim.length < 3){ showToast('NIM minimal 3 karakter', 'error'); return; }

  const mhs = AppState.mahasiswaData.find(m => m.nim === nim);
  if(!mhs){ showToast(`NIM ${nim} tidak terdaftar`, 'error'); return; }

  const qrData = { nim: mhs.nim, nama: mhs.nama, kelas: mhs.kelas, jurusan: mhs.jurusan, link_sheet: SHEET_URL, timestamp: new Date().toISOString() };
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(JSON.stringify(qrData))}`;
  DOM.qrResultImage.src = qrUrl;
  DOM.qrWho.textContent = mhs.nama || '-';
  DOM.qrSub.textContent = `${mhs.nim} · ${mhs.kelas || '-'} · ${mhs.jurusan || '-'}`;
  DOM.qrPreview.classList.add('show');
  showToast(`QR untuk ${mhs.nama} berhasil dibuat`, 'success');
}

function downloadQRCode(){
  if(!DOM.qrResultImage.src){ showToast('Tidak ada QR untuk diunduh', 'error'); return; }
  const nim = DOM.qrNimInput.value.trim() || 'mahasiswa';
  const a = document.createElement('a');
  a.download = `qr-${nim}.png`; a.href = DOM.qrResultImage.src;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  showToast('QR berhasil diunduh', 'success');
}

function closeQRPreview(){ DOM.qrPreview.classList.remove('show'); DOM.qrNimInput.value=''; }

// ================================================================
// EXPORT CSV
// ================================================================
function exportCSV(){
  if(!AppState.mahasiswaData.length){ showToast('Belum ada data untuk diekspor', 'error'); return; }
  const history = getHistoryToday();
  const hadirSet = new Set(history.map(h=>h.nim));
  const rows = [['NIM','Nama','Kelas','Jurusan','Status','Waktu']];
  AppState.mahasiswaData.forEach(m => {
    const h = history.find(x=>x.nim===m.nim);
    rows.push([m.nim, m.nama, m.kelas, m.jurusan, hadirSet.has(m.nim)?'Hadir':'Belum', h?.time || '']);
  });
  const csv = rows.map(r => r.map(v => `"${String(v??'').replace(/"/g,'""')}"`).join(';')).join('\r\n');
  const blob = new Blob(['\ufeff', csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `presensi-${todayKey().replace(/\//g,'-')}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('CSV berhasil diunduh', 'success');
}

// ================================================================
// SCANNER
// ================================================================
function toggleScanner(){ AppState.scannerRunning ? stopScanner() : startScanner(); }

function startScanner(){
  if(AppState.scannerRunning) return;
  if(AppState.html5QrCode){ try{ AppState.html5QrCode.clear(); AppState.html5QrCode=null; }catch(e){} }
  const readerEl = document.getElementById('qr-reader');
  if(readerEl) readerEl.innerHTML = '';

  DOM.btnStartScan.classList.add('stop');
  DOM.btnStartScan.innerHTML = '<i class="fas fa-stop"></i> <span id="btnScanLabel">Stop Scan</span>';

  try{
    AppState.html5QrCode = new Html5Qrcode('qr-reader', { verbose:false, formatsToSupport:[Html5QrcodeSupportedFormats.QR_CODE] });
    const config = { fps:20, 
                      qrbox:{width:280,height:280},
                      aspectRatio:1.0,
                      disableFlip:false,
                      experimentalFeatures:{ useBarCodeDetectorIfSupported:true }
                    };
    AppState.html5QrCode.start({facingMode:'environment'}, config, onScanSuccess, ()=>{})
      .then(()=>{ AppState.scannerRunning=true; DOM.scanStatusText.textContent='Mendeteksi QR Code…'; })
      .catch(()=>{
        AppState.html5QrCode.start({facingMode:'user'}, config, onScanSuccess, ()=>{})
          .then(()=>{ AppState.scannerRunning=true; DOM.scanStatusText.textContent='Mendeteksi QR Code…'; })
          .catch((err2)=>{ showToast('Gagal akses kamera: ' + err2.message, 'error'); resetScannerButton(); });
      });
  }catch(e){ showToast('Gagal inisialisasi scanner', 'error'); resetScannerButton(); }
}

function stopScanner(){
  if(AppState.html5QrCode && AppState.scannerRunning){
    AppState.html5QrCode.stop().then(()=>{
      AppState.html5QrCode.clear(); AppState.html5QrCode=null; AppState.scannerRunning=false;
      resetScannerButton(); DOM.scanStatusText.textContent='Scanner berhenti';
    }).catch(()=>{});
  } else { AppState.scannerRunning=false; resetScannerButton(); }
}

function resetScannerButton(){
  DOM.btnStartScan.classList.remove('stop');
  DOM.btnStartScan.innerHTML = '<i class="fas fa-play"></i> <span id="btnScanLabel">Mulai Scan</span>';
}

function onScanSuccess(decodedText){
  if(AppState.isProcessing) return;
  AppState.isProcessing = true;
  if(AppState.html5QrCode && AppState.scannerRunning){
    AppState.html5QrCode.stop().then(()=>{ AppState.scannerRunning=false; resetScannerButton(); }).catch(()=>{});
  }
  processPresensi(decodedText);
}

// ================================================================
// PROSES PRESENSI
// ================================================================
async function processPresensi(qrText){
  try{
    showToast('Memproses presensi…', 'info', 2000);
    let data, nim='';
    try{ data = JSON.parse(qrText); nim = data.nim || ''; }
    catch(e){ nim = qrText.trim(); data = {nim}; }

    if(!nim || nim.length < 3){
      showToast('QR tidak valid', 'error');
      AppState.isProcessing=false; setTimeout(startScanner, 1600); return;
    }

    const mhs = AppState.mahasiswaData.find(m => m.nim === nim);
    if(!mhs){
      showToast(`NIM ${nim} tidak terdaftar`, 'error');
      AppState.isProcessing=false; setTimeout(startScanner, 1600); return;
    }

    if(isHadirToday(nim)){
      showToast(`${mhs.nama} sudah presensi hari ini`, 'warning');
      DOM.scanStatusText.textContent = 'Sudah presensi';
      AppState.isProcessing=false; setTimeout(startScanner, 1600); return;
    }

    const waktu = new Date().toLocaleString('id-ID', { timeZone:'Asia/Jakarta' });
    const jam = new Date().toLocaleTimeString('id-ID', { timeZone:'Asia/Jakarta', hour:'2-digit', minute:'2-digit' });

    const payload = { action:'presensi', nim, nama:mhs.nama||'', kelas:mhs.kelas||'', jurusan:mhs.jurusan||'', mataKuliah:'Presensi Kelas', status:'Hadir', waktu };
    fetch(WEB_APP_URL, { method:'POST', mode:'no-cors', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }).catch(()=>{});

    const map = getPresensiMap();
    map[nim] = { date: todayKey(), time: jam, nama: mhs.nama, kelas: mhs.kelas, jurusan: mhs.jurusan, ts: Date.now() };
    setPresensiMap(map);

    if(localStorage.getItem('presensiNotifications') !== 'false') showToast(`${mhs.nama} hadir!`, 'success');
    DOM.scanStatusText.textContent = 'Hadir ✓';
    burstConfetti(); playChime();

    renderHome();
    renderTimeline(DOM.lastScanList, getHistoryToday(), 5);
    renderDataList(DOM.searchInput ? DOM.searchInput.value : '');

  }catch(err){
    log('presensi error', err);
    showToast('Terjadi kesalahan: ' + err.message, 'error');
    DOM.scanStatusText.textContent = 'Error';
  }finally{
    setTimeout(()=>{
      AppState.isProcessing=false;
      DOM.scanStatusText.textContent='Arahkan ke QR Code';
      if(!AppState.scannerRunning && AppState.currentView==='scan') startScanner();
    }, 2200);
  }
}

// ================================================================
// FLASH
// ================================================================
function toggleFlash(){
  AppState.flashOn = !AppState.flashOn;
  DOM.btnFlash.classList.toggle('active', AppState.flashOn);
  try{
    const track = AppState.html5QrCode?._localMediaStream?.getVideoTracks?.()[0];
    if(track && track.getCapabilities?.().torch){ track.applyConstraints({advanced:[{torch:AppState.flashOn}]}); }
  }catch(e){}
}

// ================================================================
// INIT
// ================================================================
async function checkCameraPermission(){
  try{
    if(!navigator.mediaDevices?.getUserMedia){ showToast('Browser tidak mendukung kamera', 'error'); return false; }
    const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    stream.getTracks().forEach(t=>t.stop());
    return true;
  }catch(e){ return false; }
}

async function init(){
  cacheDOM();
  setupLogin();
  if(isLoggedIn() || sessionStorage.getItem(LOGIN_STORAGE_KEY) === 'true'){
    showDashboard();
    await startApp();
  }else{
    showLanding();
  }
}

async function loadLandingStats(){
  const elTotal = document.getElementById('landingTotalMhs');
  const elHadir = document.getElementById('landingHadir');
  const elPersen = document.getElementById('landingPersen');
  if(!elTotal && !elHadir && !elPersen) return;
  try{
    const res = await fetch(`${WEB_APP_URL}?action=get_stats`);
    const data = await res.json();
    if(elTotal) elTotal.textContent = data.totalMahasiswa ?? '0';
    if(elHadir) elHadir.textContent = `${data.hadirHariIni ?? 0} hadir`;
    if(elPersen) elPersen.textContent = `${data.persen ?? 0}%`;
  }catch(err){
    if(elTotal) elTotal.textContent = '0';
    if(elHadir) elHadir.textContent = '0 hadir';
    if(elPersen) elPersen.textContent = '0%';
  }
}

document.addEventListener('DOMContentLoaded', init);
document.addEventListener('DOMContentLoaded', loadLandingStats);
window.addEventListener('beforeunload', ()=>{
  if(AppState.html5QrCode && AppState.scannerRunning){
    AppState.html5QrCode.stop().then(()=>AppState.html5QrCode.clear()).catch(()=>{});
  }
});

// ================================================================
// FITUR TAMBAHAN — DASHBOARD / MAHASISWA / RIWAYAT / PENGATURAN
// Tidak mengubah fungsi QR Scanner & Generate QR yang sudah ada.
// ================================================================

function renderHistoryPage(){
  const list = document.getElementById('historyPageList');
  const count = document.getElementById('historyTodayCount');
  const dateInput = document.getElementById('historyDate');
  if(!list) return;

  const selected = dateInput?.value || '';
  const today = new Date();
  const todayISO = new Date(today.getTime() - today.getTimezoneOffset()*60000).toISOString().slice(0,10);

  // Data presensi yang tersimpan saat ini memang berbasis hari ini.
  // Jika tanggal lain dipilih, tampilkan informasi bahwa data lokal belum tersedia.
  if(selected && selected !== todayISO){
    if(count) count.textContent = '0';
    list.innerHTML = '<div class="empty-note"><i class="fas fa-calendar-xmark"></i>Belum ada data presensi untuk tanggal tersebut</div>';
    return;
  }

  const history = getHistoryToday();
  if(count) count.textContent = history.length;

  if(!history.length){
    list.innerHTML = '<div class="empty-note"><i class="fas fa-clock-rotate-left"></i>Belum ada riwayat presensi hari ini</div>';
    return;
  }

  list.innerHTML = history.map((h, i) => `
    <div class="timeline-item history-item">
      <div class="history-number">${i+1}</div>
      <div class="avatar-dot">${initials(h.nama)}</div>
      <div class="timeline-info">
        <div class="nm">${h.nama || h.nim}</div>
        <div class="meta">${h.nim || '-'} · ${h.kelas || '-'} · ${h.jurusan || '-'}</div>
      </div>
      <div class="timeline-time">${h.time || '-'}</div>
    </div>
  `).join('');
}

function loadSettings(){
  const dark = localStorage.getItem('presensiDarkMode') !== 'false';
  const notif = localStorage.getItem('presensiNotifications') !== 'false';
  const darkEl = document.getElementById('darkModeToggle');
  const notifEl = document.getElementById('notifToggle');
  if(darkEl) darkEl.checked = dark;
  if(notifEl) notifEl.checked = notif;
  document.body.classList.toggle('light-mode', !dark);
}

function selectSettingsTab(button){
  const target = button?.dataset.settingsTarget;
  if(!target) return;
  document.querySelectorAll('.settings-menu-item').forEach(item => {
    item.classList.toggle('active', item === button);
  });
  const panel = document.querySelector(`[data-settings-panel="${target}"]`);
  if(panel && window.matchMedia('(max-width: 760px)').matches){
    panel.scrollIntoView({behavior:'smooth', block:'start'});
  }
}

function toggleDarkMode(enabled){
  localStorage.setItem('presensiDarkMode', enabled ? 'true' : 'false');
  document.body.classList.toggle('light-mode', !enabled);
  showToast(enabled ? 'Mode gelap aktif' : 'Mode terang aktif', 'success', 1800);
}

function saveSettings(){
  const notif = document.getElementById('notifToggle')?.checked ?? true;
  localStorage.setItem('presensiNotifications', notif ? 'true' : 'false');
  showToast('Pengaturan disimpan', 'success', 1800);
}

function clearLocalPresensi(){
  if(!confirm('Hapus semua data presensi lokal hari ini?')) return;
  localStorage.removeItem('presensiHariIni');
  renderHome();
  renderHistoryPage();
  renderDataList(DOM.searchInput ? DOM.searchInput.value : '');
  showToast('Presensi lokal hari ini dihapus', 'success');
}

function updateStudentCount(){
  const badge = document.getElementById('studentCountBadge');
  if(badge) badge.textContent = AppState.mahasiswaData.length;
}

// Extend view switching only by wrapping the existing function behavior.
const _originalSwitchView = switchView;
switchView = function(name){
  _originalSwitchView(name);
  if(name === 'history') renderHistoryPage();
  if(name === 'settings') loadSettings();
  if(name === 'data') updateStudentCount();
};

// Update badge whenever student data is loaded without touching its original implementation.
const _originalRenderDataList = renderDataList;
renderDataList = function(filterText=''){
  _originalRenderDataList(filterText);
  updateStudentCount();
};

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  updateStudentCount();
});
