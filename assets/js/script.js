/* assets/js/script.js - backend-enabled version */

// base URL of API
const API_BASE = '';

/* ---------- AUTH & BOOT ---------- */
async function login(){
  const u = document.getElementById('username').value.trim();
  const p = document.getElementById('password').value.trim();
  if(!u || !p){ document.getElementById('login-msg').innerText='Provide username & password'; return; }
  try{
    const resp = await fetch('/api/login', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ username: u, password: p })
    });
    const j = await resp.json();
    if(resp.ok && j.ok){
      localStorage.setItem('pfms_auth','1');
      location.href='dashboard.html';
    } else {
      document.getElementById('login-msg').innerText = j.error || 'Invalid credentials';
    }
  } catch(e){
    document.getElementById('login-msg').innerText = 'Network error';
    console.error(e);
  }
}

function logout(){
  localStorage.removeItem('pfms_auth');
  location.href='index.html';
}

async function loadDashboard(){
  if(!localStorage.getItem('pfms_auth')) { location.href='index.html'; return; }
  // if first load and no data in DB, the server DB might be empty; we will not auto-seed here.
  renderAll();
}

/* ---------- helpers (API) ---------- */

async function apiGetTransactions(month=null, year=null){
  const qs = (month !== null && year !== null) ? `?month=${month}&year=${year}` : '';
  const res = await fetch(`/api/transactions${qs}`);
  const j = await res.json();
  return j.ok ? j.transactions : [];
}

async function apiAddTransaction(obj){
  const res = await fetch('/api/transactions', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(obj)
  });
  const j = await res.json();
  return j;
}

async function apiDeleteTransaction(id){
  const res = await fetch(`/api/transactions/${id}`, { method:'DELETE' });
  const j = await res.json();
  return j;
}

async function apiGetBudgets(){
  const res = await fetch('/api/budgets');
  const j = await res.json();
  return j.ok ? j.budgets : [];
}

async function apiSetBudget(month, year, amount){
  const res = await fetch('/api/budgets', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ month, year, amount })
  });
  return await res.json();
}

/* ---------- popup ---------- */
function openPopup(){
  document.getElementById('popup').style.display='flex';
  const d = new Date().toISOString().slice(0,10);
  document.getElementById('tr-date').value = d;
  document.getElementById('tr-amount').value = '';
  document.getElementById('tr-desc').value = '';
  document.getElementById('tr-type').value = 'expense';
  onTypeChange();
}
function closePopup(){ document.getElementById('popup').style.display='none'; }
function onTypeChange(){ const type = document.getElementById('tr-type').value; const cat = document.getElementById('tr-category'); cat.style.display = type==='expense' ? 'block' : 'none'; }

/* ---------- CRUD (UI <-> API glue) ---------- */
async function saveTransaction(){
  const date = document.getElementById('tr-date').value;
  const type = document.getElementById('tr-type').value;
  const category = document.getElementById('tr-category').value;
  const desc = document.getElementById('tr-desc').value || '';
  const amount = Number(document.getElementById('tr-amount').value);
  if(!date || !amount){ alert('Provide date and amount'); return; }
  const payload = { date, type, category, description: desc, amount };
  const j = await apiAddTransaction(payload);
  if(j.ok){
    closePopup();
    renderAll();
  } else {
    alert(j.error || 'Failed to save');
  }
}

async function deleteTransactionRow(id){
  if(!confirm('Delete transaction?')) return;
  const j = await apiDeleteTransaction(id);
  if(j.ok){
    renderAll();
  } else {
    alert('Delete failed');
  }
}

/* ---------- budget ---------- */
async function setBudget(){
  const b = Number(document.getElementById('budget-input').value) || 0;
  const month = Number(document.getElementById('month-filter').value);
  const year = new Date().getFullYear(); // save for current year
  const j = await apiSetBudget(month, year, b);
  if(j.ok){
    renderAll();
  } else {
    alert('Failed to set budget');
  }
}

/* ---------- calculations & rendering ---------- */

let lineChart = null, pieChart = null;

async function calcMonthlyTotals(){
  // We fetch all transactions (server returns all) and compute totals
  const all = await apiGetTransactions(); // returns all if no month/year passed
  const income = new Array(12).fill(0);
  const expense = new Array(12).fill(0);
  all.forEach(t=>{
    const m = new Date(t.date).getMonth();
    if(t.type === 'income') income[m] += Number(t.amount);
    else expense[m] += Number(t.amount);
  });
  const savings = income.map((inc,i)=> inc - expense[i]);
  return { income, expense, savings, all };
}

async function renderTransactionsTable(){
  const month = Number(document.getElementById('month-filter').value);
  const year = new Date().getFullYear();
  const tx = await apiGetTransactions(month, year);
  const tbody = document.getElementById('transaction-table');
  tbody.innerHTML = '';
  tx.forEach(t=>{
    const row = document.createElement('tr');
    row.className = t.type === 'income' ? 'income-row' : 'expense-row';
    row.innerHTML = `
      <td>${t.date}</td>
      <td>${t.type}</td>
      <td>${t.type === 'income' ? (t.description || t.category || '') : (t.category || '')}</td>
      <td>₹${t.amount}</td>
      <td><button onclick="deleteTransactionRow(${t.id})">Delete</button></td>
    `;
    tbody.appendChild(row);
  });
}

async function renderCharts(){
  const totals = await calcMonthlyTotals();
  const { income, expense, savings } = totals;
  const labels = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  // line chart
  if(lineChart) lineChart.destroy();
  lineChart = new Chart(document.getElementById('lineChart'), {
    type: 'line',
    data: { labels, datasets:[{ label:'Savings (₹)', data: savings, borderColor:'#34d399', backgroundColor:'transparent', tension:0.3 }]},
    options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ beginAtZero:true } } }
  });

  // pie chart for selected month
  const sel = Number(document.getElementById('month-filter').value);
  const year = new Date().getFullYear();
  const tx = await apiGetTransactions(sel, year);
  const categories = {};
  tx.forEach(t=>{
    if(t.type==='expense'){
      categories[t.category] = (categories[t.category]||0) + Number(t.amount);
    }
  });
  const labelsPie = Object.keys(categories);
  const dataPie = Object.values(categories);
  if(pieChart) pieChart.destroy();
  pieChart = new Chart(document.getElementById('pieChart'), {
    type:'pie',
    data:{ labels: labelsPie.length?labelsPie:['No Data'], datasets:[{ data: labelsPie.length?dataPie:[1] }]},
    options:{ responsive:true, maintainAspectRatio:false }
  });
}

async function renderBudgetProgress(){
  const sel = Number(document.getElementById('month-filter').value);
  const year = new Date().getFullYear();
  const budgets = await apiGetBudgets();
  const matched = budgets.find(b => b.month === sel && b.year === year);
  const b = matched ? matched.amount : 0;
  const totals = await calcMonthlyTotals();
  const monthExpense = totals.expense[sel] || 0;
  const bar = document.getElementById('budget-bar');
  const info = document.getElementById('budget-info');
  if(!b){ bar.style.width='0%'; info.innerText = 'No budget set for selected month.'; return; }
  const percent = Math.min((monthExpense / b)*100, 100);
  bar.style.width = percent + '%';
  if(monthExpense > b) bar.style.background = '#ff6b6b';
  else if(percent > 80) bar.style.background = '#ffd166';
  else bar.style.background = '#34d399';
  info.innerText = `Spent ₹${monthExpense} / ₹${b} (${Math.round(percent)}%)`;
}

/* ---------- full render ---------- */
async function renderAll(){
  await renderTransactionsTable();
  await renderCharts();
  await renderBudgetProgress();
}

/* ---------- UI events ---------- */
document.addEventListener('DOMContentLoaded', ()=> {
  if(window.location.pathname.includes('dashboard.html') || window.location.pathname.endsWith('/dashboard.html')){
    loadDashboard();
  }
});

// month selector change
document.getElementById && document.getElementById('month-filter')?.addEventListener('change', () => {
  renderAll();
});
