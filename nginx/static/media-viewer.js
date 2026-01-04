const p=new URLSearchParams(window.location.search),c=p.get("share")||window.location.pathname.split("/").pop()||"",a=document.getElementById("modal"),s=document.getElementById("modal-content"),h=document.querySelector(".close");async function g(){try{const e=p.get("share")||window.location.pathname.split("/").pop()||"";if(!e)throw new Error("No share hash found");try{const n=await fetch(`/api/share/${e}/files`);if(n.ok){const t=await n.json();r(t.slice(0,10));return}}catch{console.log("Could not fetch file list from API, falling back to known files")}const i=[{name:"IMG_4481.jpeg",type:"image"},{name:"IMG_4482.mov",type:"video"},{name:"IMG_4491.jpeg",type:"image"}],o=[];for(const n of i)try{const t=`/api/share/${e}/file/${n.name}`;(await fetch(t,{method:"HEAD"})).ok&&o.push(n)}catch{console.log(`File ${n.name} not accessible via primary URL`);try{const t=`/api/public/dl/${e}/${n.name}`;(await fetch(t,{method:"HEAD"})).ok&&o.push({...n,altUrl:t})}catch{console.log(`File ${n.name} not accessible via alternative URL either`)}}o.length>0?r(o):r(i)}catch(e){console.error("Error loading media files:",e),m(`Failed to load media files: ${e instanceof Error?e.message:String(e)}`)}}function r(e){const i=document.getElementById("media-container"),o=document.getElementById("loading");o.style.display="none",i.style.display="grid",e.forEach(n=>{const t=v(n);i.appendChild(t)})}function v(e){const i=document.createElement("div");i.className="media-card";const o=e.type==="video",n=new URLSearchParams(window.location.search).get("share")||window.location.pathname.split("/").pop()||"",t=e.inline_url||`/api/public/dl/${n}/${e.name}?inline=true`,l=e.download_url||`/api/share/${n}/file/${e.name}?download=1`,y=`/api/share/${n}/preview/${e.name}`;i.innerHTML=`
    ${o?`<div style="position: relative;">
           <img class="media-preview" src="${y}" alt="${e.name}"
                style="object-fit: cover; height: 200px; width: 100%;"
                onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
           <div style="display:none; padding: 20px; text-align: center; color: #888; height: 200px; background: #333; align-items: center; justify-content: center; flex-direction: column;">
              🎬 ${e.name}<br>
              <small>Video preview unavailable</small>
           </div>
           <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 50px; height: 50px; background: rgba(0,0,0,0.6); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 20px; pointer-events: none;">▶</div>
         </div>`:`<img class="media-preview" src="${t}" alt="${e.name}"
             onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
         <div style="display:none; padding: 20px; text-align: center; color: #888;">
            🖼️ ${e.name}<br>
            <small>Image preview failed</small>
         </div>`}
    <div class="media-info">
        <div class="media-title">${e.name}</div>
        <div class="media-size">${e.type}</div>
        <a href="${l}" class="download-btn" download>📥 Download</a>
        <a href="/gallery/${n}" class="download-btn" style="background: #2196F3;">🔗 Gallery</a>
    </div>
  `;const d=i.querySelector(".media-preview");return d&&d.addEventListener("click",()=>{u(e,t)}),i}function u(e,i){if(e.type==="video"){s.innerHTML=`
      <div style="position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
          <video controls autoplay playsinline style="max-width: 100%; max-height: 100%;">
              <source src="${i}" type="video/mp4">
              <source src="${i}" type="video/quicktime">
          </video>
          <div class="video-loader">
              <div class="spinner"></div>
              <div>Loading...</div>
          </div>
      </div>
    `;const n=s.querySelector("video"),t=s.querySelector(".video-loader");n&&t&&(n.onloadstart=()=>{t.style.display="block"},n.onwaiting=()=>{t.style.display="block"},n.oncanplaythrough=()=>{t.style.display="none"},n.onplaying=()=>{t.style.display="none"})}else s.innerHTML=`<img src="${i}" alt="${e.name}" style="max-width: 100%; max-height: 100%;">`;a.style.display="block"}function m(e="Please check your share link and try again."){const i=document.getElementById("loading"),o=document.getElementById("error"),n=o.querySelector("p");i.style.display="none",o.style.display="block",n&&(n.textContent=e)}h.addEventListener("click",()=>{a.style.display="none"});a.addEventListener("click",e=>{e.target===a&&(a.style.display="none")});document.addEventListener("keydown",e=>{e.key==="Escape"&&(a.style.display="none")});c&&c!=="media-viewer.html"?g():m("No valid share hash found in URL. Please use a proper share link.");
//# sourceMappingURL=media-viewer.js.map
