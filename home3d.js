/* Model 3D mieszkania odtworzony z rzutu (1 px rzutu ≈ 1 cm).
   Pokoje: salon z aneksem (1), sypialnia (2), łazienka (3), przedpokój (4).
   Ściany przycięte na ~1 m (widok „domek dla lalek”), światła w pokojach reagują na stan urządzeń. */
(function(){
  const S = 0.01;            // px → metry
  const CX = 567, CY = 508;  // środek rzutu
  const WALL_H = 1.05;
  const P = (x, y) => [(x - CX) * S, (y - CY) * S];

  const WALLS = [
    [80,128,1055,155],[80,128,125,255],[80,460,125,600],[80,765,125,888],[80,840,1055,888],
    [1030,128,1055,520],[1030,635,1055,888],
    [125,515,715,527],[665,645,685,840],[665,645,795,660],[890,645,1030,660],
    [835,420,1030,432],[835,420,847,500],
  ];
  const WINDOWS = [[80,255,125,460],[80,600,125,765]];
  const ROOMS = {
    salon:     {rects:[[125,155,1030,420],[125,420,715,515]], color:'#e7d9c4', light:[560,300]},
    sypialnia: {rects:[[125,527,665,840],[665,527,715,645]],  color:'#ecdfcc', light:[400,690]},
    lazienka:  {rects:[[685,660,1030,840]],                   color:'#e3e6ea', light:[860,750]},
    przedpokoj:{rects:[[715,420,1030,645]],                   color:'#dcdad6', light:[900,560]},
  };
  const FURN = [
    [665,155,960,222,.9,'#efebe4'],[960,225,1030,415,.9,'#efebe4'],
    [172,165,460,212,.72,'#b9b1a6'],[172,212,290,360,.42,'#c7bfb4'],[290,212,460,265,.42,'#c7bfb4'],
    [330,285,402,355,.38,'#d6cab8'],[550,372,646,505,.75,'#a88763'],[245,465,415,505,.45,'#2f3240'],
    [330,600,525,835,.48,'#f4efe7'],[340,770,520,828,.6,'#ffffff'],[142,527,262,585,.74,'#a88763'],
    [550,645,665,835,.95,'#e6e0d6'],[685,662,765,838,.55,'#fafafa'],[780,795,850,838,.85,'#fafafa'],
    [895,765,935,832,.45,'#fafafa'],[940,662,1020,738,.85,'#f0f0f0'],[847,432,1030,500,.95,'#e6e0d6'],
  ];
  const DEVICE_SPOTS = { coffee:[892,175,.9] };   // ekspres na blacie

  let renderer, scene, camera, el, labelsEl, floors = {}, lights = {}, bulbs = {}, coffee, sel = null;
  let az = -0.5, pol = 0.86, dist = 18.5, needs = true, raf = 0;
  const target = new THREE.Vector3(0, 0, 0.25);

  function box(x1,y1,x2,y2,h,color,y0=0,opts={}){
    const [ax,az1] = P(x1,y1), [bx,bz] = P(x2,y2);
    const g = new THREE.BoxGeometry(Math.abs(bx-ax), h, Math.abs(bz-az1));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({color, roughness:.85, metalness:0, ...opts}));
    m.position.set((ax+bx)/2, y0 + h/2, (az1+bz)/2);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m); return m;
  }

  function build(container, onRoom){
    el = container;
    renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    el.appendChild(renderer.domElement);
    labelsEl = document.createElement('div'); labelsEl.className = 'h3-labels'; el.appendChild(labelsEl);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, .1, 100);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c3d6, .42));
    const sun = new THREE.DirectionalLight(0xffffff, .5);
    sun.position.set(-6, 10, 4); sun.castShadow = true;
    sun.shadow.mapSize.set(1024,1024); Object.assign(sun.shadow.camera, {left:-7,right:7,top:7,bottom:-7});
    scene.add(sun);

    // podstawa pod mieszkaniem
    box(60,108,1075,908,.08,'#cfd6e3',-.08);
    for(const [k,r] of Object.entries(ROOMS)){
      floors[k] = r.rects.map(([a,b,c,d]) => {
        const m = box(a,b,c,d,.02,r.color,0,{});
        m.castShadow = false; m.userData.room = k; return m;
      });
      const [lx,lz] = P(...r.light);
      const L = new THREE.PointLight(0xffb85c, 0, 5.5, 1.6);
      L.position.set(lx, .95, lz); scene.add(L); lights[k] = L;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(.09, 16, 12), new THREE.MeshBasicMaterial({color:0xd9d9d9}));
      bulb.position.set(lx, 1.15, lz); scene.add(bulb); bulbs[k] = bulb;
      const lab = document.createElement('button');
      lab.className = 'h3-lab'; lab.dataset.room = k;
      lab.onclick = (e) => { e.stopPropagation(); onRoom && onRoom(k) };
      labelsEl.appendChild(lab);
    }
    for(const w of WALLS) box(...w, WALL_H, '#fbfbfd');
    for(const w of WINDOWS){
      box(...w, .25, '#fbfbfd');
      const g = box(w[0]+14,w[1],w[2]-14,w[3], WALL_H-.25, '#a9c6ee', .25, {transparent:true, opacity:.35, roughness:.1});
      g.castShadow = false;
    }
    for(const f of FURN) box(...f);
    const [cx1,cy1,ch] = DEVICE_SPOTS.coffee;
    coffee = box(cx1,cy1,cx1+26,cy1+28,.32,'#2a2d38',ch,{emissive:0x000000});

    // obracanie palcem, przybliżanie dwoma palcami
    const pts = new Map(); let lastPinch = 0, moved = 0;
    el.addEventListener('pointerdown', e => { pts.set(e.pointerId,{x:e.clientX,y:e.clientY}); moved = 0; el.setPointerCapture(e.pointerId) });
    el.addEventListener('pointermove', e => {
      if(!pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId), dx = e.clientX-p.x, dy = e.clientY-p.y;
      pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pts.size === 1){ az -= dx*.008; pol = Math.min(1.25, Math.max(.45, pol - dy*.006)); moved += Math.abs(dx)+Math.abs(dy) }
      else if(pts.size === 2){
        const [a,b] = [...pts.values()]; const d = Math.hypot(a.x-b.x, a.y-b.y);
        if(lastPinch) dist = Math.min(30, Math.max(9, dist * lastPinch / d)); lastPinch = d; moved = 99;
      }
      kick();
    });
    const up = e => {
      if(pts.size === 1 && moved < 6) pick(e, onRoom);
      pts.delete(e.pointerId); if(pts.size < 2) lastPinch = 0;
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => { e.preventDefault(); dist = Math.min(30, Math.max(9, dist * (1 + e.deltaY*.001))); kick() }, {passive:false});
    new ResizeObserver(() => { resize(); kick() }).observe(el);
    resize();
  }

  function pick(e, onRoom){
    const r = el.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1, -((e.clientY-r.top)/r.height)*2+1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(v, camera);
    const hit = ray.intersectObjects(Object.values(floors).flat())[0];
    if(hit && onRoom) onRoom(hit.object.userData.room);
  }

  function resize(){
    const w = el.clientWidth, h = el.clientHeight; if(!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w/h; camera.updateProjectionMatrix();
  }
  function kick(){ needs = true; if(!raf) raf = requestAnimationFrame(loop) }
  function loop(){
    raf = 0; if(!needs) return; needs = false;
    camera.position.set(target.x + dist*Math.sin(pol)*Math.sin(az), target.y + dist*Math.cos(pol), target.z + dist*Math.sin(pol)*Math.cos(az));
    camera.lookAt(target);
    renderer.render(scene, camera);
    placeLabels();
  }
  function placeLabels(){
    const r = el.getBoundingClientRect();
    for(const lab of labelsEl.children){
      const k = lab.dataset.room, [x,z] = P(...ROOMS[k].light);
      const v = new THREE.Vector3(x, .4, z).project(camera);
      lab.style.transform = `translate(${(v.x+1)/2*r.width}px, ${(1-v.y)/2*r.height}px) translate(-50%,-50%)`;
    }
  }

  // stan z aplikacji: {rooms:{salon:{on,level,label}}, coffee:bool, selected}
  function update(state){
    for(const [k,L] of Object.entries(lights)){
      const st = state.rooms[k] || {};
      const lvl = st.on ? Math.max(.15, (st.level ?? 100)/100) : 0;
      L.intensity = lvl * 4.2;
      bulbs[k].material.color.set(st.on ? 0xffd38f : 0xd9d9d9);
      for(const f of floors[k]){
        if(k === state.selected){ f.material.emissive.set(0x2a55c9); f.material.emissiveIntensity = .22 }
        else if(st.on){ f.material.emissive.set(0xffa53a); f.material.emissiveIntensity = .12 + lvl*.22 }
        else f.material.emissive.set(0x000000);
      }
    }
    coffee.material.emissive.set(state.coffee ? 0xff8a3c : 0x000000); coffee.material.emissiveIntensity = .7;
    for(const lab of labelsEl.children){
      const st = state.rooms[lab.dataset.room] || {};
      lab.textContent = st.label || '';
      lab.classList.toggle('on', !!st.on); lab.classList.toggle('sel', lab.dataset.room === state.selected);
    }
    kick();
  }

  window.Home3D = { build, update, kick, resize };
})();
