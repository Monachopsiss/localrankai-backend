import { useState, useEffect } from "react";

const API_BASE = "https://localrankai-backend.onrender.com";
// For local testing: const API_BASE = "http://localhost:3001";

function calcProfileScore(biz) {
  let s = 0;
  if (biz.website) s += 20; if (biz.hasHours) s += 20; if (biz.phone) s += 20;
  if (biz.hasDescription) s += 20; if (biz.photos >= 10) s += 15; if (biz.photos >= 5) s += 5;
  return Math.min(s, 100);
}
function calcReviewScore(biz) {
  let s = 0;
  if (biz.rating >= 4.5) s += 35; else if (biz.rating >= 4.0) s += 22; else if (biz.rating >= 3.5) s += 10; else s += 3;
  if (biz.reviews >= 200) s += 35; else if (biz.reviews >= 50) s += 22; else if (biz.reviews >= 20) s += 12; else s += 3;
  if (biz.responseRate >= 80) s += 30; else if (biz.responseRate >= 40) s += 16;
  return Math.min(s, 100);
}
function calcRankingScore(rankings) {
  const found = rankings.filter(r => r.position !== null);
  if (!found.length) return 15;
  const avg = found.reduce((s, r) => s + r.position, 0) / found.length;
  if (avg <= 1) return 98; if (avg <= 3) return 80; if (avg <= 5) return 60; if (avg <= 8) return 40; return 20;
}
function calcCompetitorScore(biz, comps) {
  if (!comps.length) return 50;
  const avgR = comps.reduce((s, c) => s + (c.rating || 0), 0) / comps.length;
  const avgV = comps.reduce((s, c) => s + (c.reviews || 0), 0) / comps.length;
  let s = 0;
  if (biz.rating >= avgR) s += 50; else s += Math.max(0, 50 - (avgR - biz.rating) * 20);
  if (biz.reviews >= avgV) s += 50; else s += Math.max(0, 50 - ((avgV - biz.reviews) / Math.max(avgV, 1)) * 50);
  return Math.round(Math.min(s, 100));
}

async function getAIRecs(data) {
  const avgR = data.competitors.length ? (data.competitors.reduce((s,c)=>s+(c.rating||0),0)/data.competitors.length).toFixed(1) : "N/A";
  const avgV = data.competitors.length ? Math.round(data.competitors.reduce((s,c)=>s+(c.reviews||0),0)/data.competitors.length) : "N/A";
  const ranks = (data.rankings||[]).map(r=>`"${r.keyword}"→${r.position?`#${r.position}`:"not found"}`).join(", ");
  const prompt = `You are a local SEO expert. Return ONLY a JSON array of 5 objects with keys: priority (high/medium/low), title (max 6 words), action (1-2 specific sentences), impact (e.g. "+20% visibility"). No markdown, no extra text.

Business: ${data.business.name} | Rating: ${data.business.rating} (${data.business.reviews} reviews) | Response rate: ${data.business.responseRate}%
Profile: website=${data.business.website}, hours=${data.business.hasHours}, phone=${data.business.phone}, desc=${data.business.hasDescription}, photos=${data.business.photos}
Competitors: avg rating ${avgR}, avg reviews ${avgV}
Rankings: ${ranks||"none"}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, messages:[{role:"user",content:prompt}] })
  });
  const d = await res.json();
  return JSON.parse(d.content.map(i=>i.text||"").join("").replace(/```json|```/g,"").trim());
}

const Ring = ({score,size=80,stroke=7}) => {
  const r=(size-stroke*2)/2, circ=2*Math.PI*r, dash=(score/100)*circ;
  const col=score>=70?"#22d3a5":score>=45?"#f59e0b":"#ef4444";
  return <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
    <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e293b" strokeWidth={stroke}/>
    <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={stroke} strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{transition:"stroke-dasharray 1.2s ease"}}/>
  </svg>;
};
const Card = ({label,score,icon}) => {
  const col=score>=70?"#22d3a5":score>=45?"#f59e0b":"#ef4444";
  return <div style={{background:`${col}10`,border:`1px solid ${col}22`,borderRadius:12,padding:"14px 18px",display:"flex",alignItems:"center",gap:14}}>
    <div style={{position:"relative",width:52,height:52,flexShrink:0}}>
      <Ring score={score} size={52} stroke={5}/>
      <span style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:col,fontFamily:"monospace"}}>{score}</span>
    </div>
    <div>
      <div style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:2}}>{icon} {label}</div>
      <div style={{fontSize:12,color:col,fontWeight:600}}>{score>=70?"Good":score>=45?"Needs work":"Critical"}</div>
    </div>
  </div>;
};
const Badge = ({p}) => {
  const m={high:["#ef4444","#ef444422"],medium:["#f59e0b","#f59e0b22"],low:["#22d3a5","#22d3a522"]};
  const [c,b]=m[p]||m.low;
  return <span style={{background:b,color:c,border:`1px solid ${c}44`,borderRadius:4,fontSize:10,fontWeight:700,padding:"2px 6px",textTransform:"uppercase"}}>{p}</span>;
};

export default function App() {
  const [phase,setPhase]=useState("search");
  const [form,setForm]=useState({name:"",location:"",category:""});
  const [data,setData]=useState(null);
  const [scores,setScores]=useState(null);
  const [recs,setRecs]=useState(null);
  const [step,setStep]=useState(0);
  const [error,setError]=useState(null);
  const steps=["Finding your business on Google…","Pulling live ratings & reviews…","Scanning nearby competitors…","Checking search rankings…","Running AI analysis…"];

  useEffect(()=>{
    if(phase!=="loading") return;
    let i=0; const t=setInterval(()=>{i++;if(i<steps.length)setStep(i);},1200);
    return()=>clearInterval(t);
  },[phase]);

  const run=async()=>{
    if(!form.name||!form.location||!form.category) return;
    setPhase("loading");setStep(0);setError(null);
    try {
      const res=await fetch(`${API_BASE}/api/audit`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
      const d=await res.json();
      if(!res.ok) throw new Error(d.error||"Audit failed");
      const ps=calcProfileScore(d.business), rs=calcReviewScore(d.business);
      const rks=calcRankingScore(d.rankings||[]), cs=calcCompetitorScore(d.business,d.competitors||[]);
      setScores({overall:Math.round((ps+rs+rks+cs)/4),profile:ps,reviews:rs,rankings:rks,competitors:cs});
      setData(d); setPhase("results");
      const ai=await getAIRecs(d); setRecs(ai);
    } catch(e){setError(e.message);setPhase("search");}
  };

  return <>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;} body{background:#070d1a;}
      input::placeholder{color:#475569;} input:focus{outline:none;border-color:#22d3a5!important;}
      @keyframes spin{to{transform:rotate(360deg);}}
      @keyframes fadeUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
      .fu{animation:fadeUp .5s ease forwards;}
      .card{background:#0f172a;border:1px solid #1e293b;border-radius:14px;}
      .btn{background:linear-gradient(135deg,#22d3a5,#3b82f6);color:#fff;border:none;border-radius:10px;padding:12px 28px;font-size:14px;font-weight:700;cursor:pointer;font-family:'Syne',sans-serif;transition:opacity .2s,transform .15s;}
      .btn:hover{opacity:.88;transform:translateY(-1px);} .btn:disabled{opacity:.4;cursor:not-allowed;transform:none;}
    `}</style>
    <div style={{minHeight:"100vh",background:"#070d1a",color:"#e2e8f0",fontFamily:"'Syne',sans-serif"}}>
      <header style={{borderBottom:"1px solid #1e293b",padding:"0 28px",height:58,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:9}}>
          <div style={{width:26,height:26,background:"linear-gradient(135deg,#22d3a5,#3b82f6)",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>🔍</div>
          <span style={{fontSize:15,fontWeight:700,letterSpacing:"-0.02em"}}>LocalRank<span style={{color:"#22d3a5"}}>AI</span></span>
        </div>
        <span style={{background:"#22d3a522",color:"#22d3a5",border:"1px solid #22d3a533",borderRadius:20,fontSize:10,padding:"3px 10px",fontWeight:600}}>EU BETA</span>
      </header>

      {phase==="search" && <div style={{maxWidth:600,margin:"0 auto",padding:"72px 24px 40px"}} className="fu">
        <div style={{textAlign:"center",marginBottom:44}}>
          <div style={{display:"inline-block",background:"#22d3a511",border:"1px solid #22d3a533",borderRadius:20,padding:"3px 12px",fontSize:11,color:"#22d3a5",fontWeight:600,letterSpacing:"0.08em",marginBottom:18,textTransform:"uppercase"}}>Free Local SEO Audit</div>
          <h1 style={{fontSize:"clamp(24px,5vw,42px)",fontWeight:800,lineHeight:1.1,letterSpacing:"-0.03em",color:"#f1f5f9",marginBottom:12}}>See how your business<br/><span style={{color:"#22d3a5"}}>ranks against competitors</span></h1>
          <p style={{color:"#64748b",fontSize:14,lineHeight:1.65}}>Real Google data · AI-powered recommendations · 30 seconds</p>
        </div>
        <div className="card" style={{padding:28,display:"flex",flexDirection:"column",gap:14}}>
          {[{k:"name",l:"Business Name",p:"e.g. Café Tivoli",i:"🏢"},{k:"location",l:"City / Location",p:"e.g. Ljubljana, Slovenia",i:"📍"},{k:"category",l:"Category",p:"e.g. Restaurant, Dentist, Gym…",i:"🏷️"}].map(f=>(
            <div key={f.k}>
              <label style={{display:"block",fontSize:10,color:"#94a3b8",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:600}}>{f.i} {f.l}</label>
              <input value={form[f.k]} onChange={e=>setForm(p=>({...p,[f.k]:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&run()} placeholder={f.p}
                style={{width:"100%",background:"#070d1a",border:"1px solid #1e293b",borderRadius:8,padding:"11px 14px",color:"#e2e8f0",fontSize:14,fontFamily:"'Syne',sans-serif",transition:"border-color .2s"}}/>
            </div>
          ))}
          {error && <div style={{background:"#ef444411",border:"1px solid #ef444433",borderRadius:7,padding:"10px 13px",color:"#ef4444",fontSize:12}}>⚠️ {error}</div>}
          <button className="btn" style={{marginTop:4}} disabled={!form.name||!form.location||!form.category} onClick={run}>Run Free SEO Audit →</button>
          <p style={{textAlign:"center",fontSize:11,color:"#334155"}}>No account needed · Powered by Google + Claude AI</p>
        </div>
      </div>}

      {phase==="loading" && <div style={{maxWidth:420,margin:"0 auto",padding:"110px 24px",textAlign:"center"}} className="fu">
        <div style={{width:54,height:54,border:"3px solid #1e293b",borderTopColor:"#22d3a5",borderRadius:"50%",margin:"0 auto 28px",animation:"spin 1s linear infinite"}}/>
        <h2 style={{fontSize:19,fontWeight:700,color:"#f1f5f9",marginBottom:24}}>Auditing <span style={{color:"#22d3a5"}}>{form.name}</span></h2>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {steps.map((s,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:9,opacity:i<=step?1:0.2,transition:"opacity .4s",fontSize:13,color:i<step?"#22d3a5":"#e2e8f0"}}>
              <span>{i<step?"✅":i===step?"⏳":"○"}</span>{s}
            </div>
          ))}
        </div>
      </div>}

      {phase==="results" && data && scores && <div style={{maxWidth:880,margin:"0 auto",padding:"36px 24px 72px"}} className="fu">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24,flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:3}}>Live Audit Report</div>
            <h2 style={{fontSize:20,fontWeight:800,color:"#f1f5f9",letterSpacing:"-0.02em"}}>{data.business.name}</h2>
            <div style={{fontSize:12,color:"#475569",marginTop:2}}>{data.business.address}</div>
          </div>
          <button className="btn" style={{padding:"9px 20px",fontSize:12}} onClick={()=>{setPhase("search");setData(null);setRecs(null);}}>← New Audit</button>
        </div>

        <div className="card" style={{padding:28,marginBottom:14,display:"flex",alignItems:"center",gap:24,background:"linear-gradient(135deg,#0f172a 60%,#0d2a1f)"}}>
          <div style={{position:"relative",flexShrink:0}}>
            <Ring score={scores.overall} size={96} stroke={8}/>
            <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
              <span style={{fontSize:24,fontWeight:800,color:scores.overall>=70?"#22d3a5":scores.overall>=45?"#f59e0b":"#ef4444",lineHeight:1}}>{scores.overall}</span>
              <span style={{fontSize:9,color:"#64748b",fontWeight:600}}>/100</span>
            </div>
          </div>
          <div>
            <div style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Overall SEO Score</div>
            <div style={{fontSize:18,fontWeight:700,color:"#f1f5f9",marginBottom:4}}>{scores.overall>=70?"Strong presence 💪":scores.overall>=45?"Room for improvement":"Critical issues found ⚠️"}</div>
            <div style={{fontSize:12,color:"#64748b"}}>Based on live Google data for {data.business.name}</div>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))",gap:10,marginBottom:14}}>
          <Card label="Profile" score={scores.profile} icon="📋"/>
          <Card label="Reviews" score={scores.reviews} icon="⭐"/>
          <Card label="Rankings" score={scores.rankings} icon="📈"/>
          <Card label="vs Competitors" score={scores.competitors} icon="🏁"/>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          <div className="card" style={{padding:22}}>
            <h3 style={{fontSize:12,fontWeight:700,color:"#f1f5f9",marginBottom:12,textTransform:"uppercase",letterSpacing:"0.06em"}}>📊 Competitor Benchmark</h3>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr>{["Business","⭐","Reviews"].map(h=><th key={h} style={{textAlign:"left",color:"#475569",paddingBottom:7,fontSize:10,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
              <tbody>
                <tr style={{background:"#22d3a511"}}>
                  <td style={{padding:"6px 4px",color:"#22d3a5",fontWeight:700}}>{data.business.name.split(" ").slice(0,2).join(" ")} (you)</td>
                  <td style={{padding:"6px 8px",fontFamily:"monospace"}}>{data.business.rating}</td>
                  <td style={{padding:"6px 8px",fontFamily:"monospace"}}>{data.business.reviews}</td>
                </tr>
                {(data.competitors||[]).map((c,i)=>(
                  <tr key={i} style={{borderTop:"1px solid #1e293b"}}>
                    <td style={{padding:"6px 4px",color:"#94a3b8"}}>{c.name}</td>
                    <td style={{padding:"6px 8px",color:"#94a3b8",fontFamily:"monospace"}}>{c.rating||"–"}</td>
                    <td style={{padding:"6px 8px",color:"#94a3b8",fontFamily:"monospace"}}>{c.reviews||"–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card" style={{padding:22}}>
            <h3 style={{fontSize:12,fontWeight:700,color:"#f1f5f9",marginBottom:12,textTransform:"uppercase",letterSpacing:"0.06em"}}>📋 Profile Checklist</h3>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {[["Website linked",data.business.website],["Business hours set",data.business.hasHours],["Phone number listed",data.business.phone],["Business description",data.business.hasDescription],["10+ photos",data.business.photos>=10],["5+ photos",data.business.photos>=5]].map(([l,ok])=>(
                <div key={l} style={{display:"flex",alignItems:"center",gap:8,fontSize:12}}>
                  <span>{ok?"✅":"❌"}</span>
                  <span style={{color:ok?"#64748b":"#f1f5f9",fontWeight:ok?400:500}}>{l}</span>
                  {!ok&&<span style={{marginLeft:"auto",fontSize:9,color:"#ef4444",fontWeight:700,background:"#ef444411",border:"1px solid #ef444422",borderRadius:3,padding:"1px 5px"}}>FIX</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {data.business.recentReviews?.length>0&&<div className="card" style={{padding:22,marginBottom:12}}>
          <h3 style={{fontSize:12,fontWeight:700,color:"#f1f5f9",marginBottom:12,textTransform:"uppercase",letterSpacing:"0.06em"}}>💬 Recent Google Reviews</h3>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {data.business.recentReviews.map((r,i)=>(
              <div key={i} style={{background:"#070d1a",borderRadius:7,padding:"10px 12px",border:"1px solid #1e293b"}}>
                <div style={{display:"flex",gap:7,marginBottom:4,alignItems:"center"}}>
                  <span style={{color:"#f59e0b",fontSize:12}}>{"★".repeat(r.rating)}{"☆".repeat(5-r.rating)}</span>
                  <span style={{fontSize:10,color:"#475569"}}>{r.time}</span>
                </div>
                <p style={{fontSize:11,color:"#64748b",lineHeight:1.5}}>{r.text||"(no text)"}</p>
              </div>
            ))}
          </div>
        </div>}

        <div className="card" style={{padding:24,marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:17}}>
            <h3 style={{fontSize:12,fontWeight:700,color:"#f1f5f9",textTransform:"uppercase",letterSpacing:"0.06em"}}>🤖 AI Action Plan</h3>
            <span style={{background:"#3b82f622",color:"#60a5fa",border:"1px solid #3b82f633",borderRadius:4,fontSize:9,padding:"2px 7px",fontWeight:700}}>CLAUDE AI</span>
          </div>
          {!recs?<div style={{display:"flex",alignItems:"center",gap:9,color:"#475569",fontSize:12}}>
            <div style={{width:14,height:14,border:"2px solid #475569",borderTopColor:"#22d3a5",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
            Generating recommendations from real data…
          </div>:<div style={{display:"flex",flexDirection:"column",gap:10}}>
            {recs.map((r,i)=>(
              <div key={i} style={{background:"#070d1a",border:"1px solid #1e293b",borderRadius:9,padding:"13px 16px",display:"flex",gap:12,alignItems:"flex-start"}}>
                <span style={{fontFamily:"monospace",fontWeight:700,color:"#334155",fontSize:15,lineHeight:1.2,flexShrink:0}}>0{i+1}</span>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4,flexWrap:"wrap"}}>
                    <span style={{fontSize:12,fontWeight:700,color:"#f1f5f9"}}>{r.title}</span>
                    <Badge p={r.priority}/>
                    <span style={{marginLeft:"auto",fontSize:11,color:"#22d3a5",fontWeight:600,fontFamily:"monospace"}}>{r.impact}</span>
                  </div>
                  <p style={{fontSize:11,color:"#64748b",lineHeight:1.6}}>{r.action}</p>
                </div>
              </div>
            ))}
          </div>}
        </div>

        <div style={{background:"linear-gradient(135deg,#0f2a1e,#0a1628)",border:"1px solid #22d3a533",borderRadius:13,padding:"24px 28px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:14}}>
          <div>
            <div style={{fontSize:16,fontWeight:700,color:"#f1f5f9",marginBottom:3}}>Want unlimited audits + PDF reports?</div>
            <div style={{fontSize:12,color:"#64748b"}}>Pro plan — €19/month · White-label for agencies · Cancel anytime</div>
          </div>
          <button className="btn">Upgrade to Pro →</button>
        </div>
      </div>}
    </div>
  </>;
}
