var reports=[
  {
    "name": "2026-07-19_150001",
    "path": "/data/oncall/2026-07-19_150001",
    "date": "2026-07-19",
    "time": "150001"
  },
  {
    "name": "2026-07-19_140001",
    "path": "/data/oncall/2026-07-19_140001",
    "date": "2026-07-19",
    "time": "140001"
  },
  {
    "name": "2026-07-18_150001",
    "path": "/data/oncall/2026-07-18_150001",
    "date": "2026-07-18",
    "time": "150001"
  },
  {
    "name": "2026-07-18_140001",
    "path": "/data/oncall/2026-07-18_140001",
    "date": "2026-07-18",
    "time": "140001"
  },
  {
    "name": "2026-07-17_150001",
    "path": "/data/oncall/2026-07-17_150001",
    "date": "2026-07-17",
    "time": "150001"
  },
  {
    "name": "2026-07-17_140001",
    "path": "/data/oncall/2026-07-17_140001",
    "date": "2026-07-17",
    "time": "140001"
  },
  {
    "name": "2026-07-16_150001",
    "path": "/data/oncall/2026-07-16_150001",
    "date": "2026-07-16",
    "time": "150001"
  },
  {
    "name": "2026-07-16_140001",
    "path": "/data/oncall/2026-07-16_140001",
    "date": "2026-07-16",
    "time": "140001"
  },
  {
    "name": "2026-07-15_150001",
    "path": "/data/oncall/2026-07-15_150001",
    "date": "2026-07-15",
    "time": "150001"
  },
  {
    "name": "2026-07-15_140001",
    "path": "/data/oncall/2026-07-15_140001",
    "date": "2026-07-15",
    "time": "140001"
  },
  {
    "name": "2026-07-14_150002",
    "path": "/data/oncall/2026-07-14_150002",
    "date": "2026-07-14",
    "time": "150002"
  },
  {
    "name": "2026-07-14_140001",
    "path": "/data/oncall/2026-07-14_140001",
    "date": "2026-07-14",
    "time": "140001"
  },
  {
    "name": "2026-07-13_150001",
    "path": "/data/oncall/2026-07-13_150001",
    "date": "2026-07-13",
    "time": "150001"
  },
  {
    "name": "2026-07-13_140001",
    "path": "/data/oncall/2026-07-13_140001",
    "date": "2026-07-13",
    "time": "140001"
  },
  {
    "name": "2026-07-12_150001",
    "path": "/data/oncall/2026-07-12_150001",
    "date": "2026-07-12",
    "time": "150001"
  },
  {
    "name": "2026-07-12_140001",
    "path": "/data/oncall/2026-07-12_140001",
    "date": "2026-07-12",
    "time": "140001"
  },
  {
    "name": "2026-07-11_150001",
    "path": "/data/oncall/2026-07-11_150001",
    "date": "2026-07-11",
    "time": "150001"
  },
  {
    "name": "2026-07-11_140002",
    "path": "/data/oncall/2026-07-11_140002",
    "date": "2026-07-11",
    "time": "140002"
  },
  {
    "name": "2026-07-10_150001",
    "path": "/data/oncall/2026-07-10_150001",
    "date": "2026-07-10",
    "time": "150001"
  },
  {
    "name": "2026-07-10_140001",
    "path": "/data/oncall/2026-07-10_140001",
    "date": "2026-07-10",
    "time": "140001"
  },
  {
    "name": "2026-07-09_150002",
    "path": "/data/oncall/2026-07-09_150002",
    "date": "2026-07-09",
    "time": "150002"
  },
  {
    "name": "2026-07-09_140001",
    "path": "/data/oncall/2026-07-09_140001",
    "date": "2026-07-09",
    "time": "140001"
  },
  {
    "name": "2026-07-08_150002",
    "path": "/data/oncall/2026-07-08_150002",
    "date": "2026-07-08",
    "time": "150002"
  },
  {
    "name": "2026-07-08_140002",
    "path": "/data/oncall/2026-07-08_140002",
    "date": "2026-07-08",
    "time": "140002"
  },
  {
    "name": "2026-07-07_150001",
    "path": "/data/oncall/2026-07-07_150001",
    "date": "2026-07-07",
    "time": "150001"
  },
  {
    "name": "2026-07-07_140001",
    "path": "/data/oncall/2026-07-07_140001",
    "date": "2026-07-07",
    "time": "140001"
  },
  {
    "name": "2026-07-06_150001",
    "path": "/data/oncall/2026-07-06_150001",
    "date": "2026-07-06",
    "time": "150001"
  },
  {
    "name": "2026-07-06_140001",
    "path": "/data/oncall/2026-07-06_140001",
    "date": "2026-07-06",
    "time": "140001"
  }
];
var el=document.getElementById('list');
// Group by date
var byDate={};
reports.forEach(function(r){
  if(!byDate[r.date]) byDate[r.date]=[];
  byDate[r.date].push(r);
});
var html='';
Object.keys(byDate).sort().reverse().forEach(function(date){
  var weekday=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(date+'T12:00:00Z').getUTCDay()];
  html+='<div class="oncall-date">📅 '+date+' <span style="font-size:11px;font-weight:normal;color:#888;margin-left:8px">'+weekday+'</span></div>';
  html+='<div class="oncall-day-row">';
  byDate[date].sort(function(a,b){return b.time.localeCompare(a.time)}).forEach(function(r){
    var time=r.time?r.time.substring(0,2)+':'+r.time.substring(2,4)+' UTC':'';
    html+='<div class="oncall-item"><span class="oncall-time">'+time+'</span><a href="'+r.path+'/report.html" target="_blank" class="oncall-link">📄 View Triage Report</a></div>';
  });
  html+='</div>';
});
if(!html) html='<div class="oncall-empty">No reports generated yet. Reports appear here after scheduled on-call triage runs.</div>';
el.innerHTML=html;
