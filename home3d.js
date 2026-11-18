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
  ];
  const INNER = [   // ściany działowe — niższe, żeby było widać, co dzieje się w pokojach
    [125,515,715,527],[665,645,685,840],[665,645,795,660],[890,645,1030,660],
    [835,420,1030,432],[835,420,847,500],
  ];
  const INNER_H = .62;
  const WINDOWS = [[80,255,125,460],[80,600,125,765]];
  const ROOMS = {
    salon:     {rects:[[125,155,1030,420],[125,420,715,515]], color:'#e7d9c4', light:[560,300]},
    sypialnia: {rects:[[125,527,665,840],[665,527,715,645]],  color:'#ecdfcc', light:[400,690]},
    lazienka:  {rects:[[685,660,1030,840]],                   color:'#e3e6ea', light:[860,750]},
    przedpokoj:{rects:[[715,420,1030,645]],                   color:'#dcdad6', light:[800,575]},
  };
  const FURN = [
    [665,155,960,222,.9,'#efebe4'],[960,225,1030,415,.9,'#efebe4'],
    [172,165,460,212,.72,'#b9b1a6'],[172,212,290,360,.42,'#c7bfb4'],[290,212,460,265,.42,'#c7bfb4'],
    [330,285,402,355,.38,'#d6cab8'],[550,372,646,505,.75,'#a88763'],[245,465,415,505,.45,'#2f3240'],
    [330,600,525,835,.48,'#f4efe7'],[340,770,520,828,.6,'#ffffff'],[142,527,262,585,.74,'#a88763'],
    [550,645,665,835,.95,'#e6e0d6'],[685,662,765,838,.55,'#fafafa'],[780,795,850,838,.85,'#fafafa'],
    [895,765,935,832,.45,'#fafafa'],[847,432,1030,500,.95,'#e6e0d6'],
  ];
  const DEVICE_SPOTS = { coffee:[892,175,.9] };   // ekspres na blacie
  // odkurzacz: stacja w przedpokoju, strefy sprzątania i przejazd przez drzwi
  const VAC_DOCK = [970,606];
  const VAC_ZONES = {
    salon:    {rect:[165,285,640,495], via:[[880,560],[770,470]]},
    kuchnia:  {rect:[690,240,945,400], via:[[880,560],[770,470],[800,410]]},
    sypialnia:{rect:[145,600,318,828], via:[[770,580],[690,590],[540,592]]},   // obok łóżka, nie pod nim
  };
  const VAC_SPEED = .95; // m/s w modelu (szybciej niż naprawdę, żeby było widać ruch)
  function zigzag([x1,y1,x2,y2]){ const pts = []; let r = 0; for(let y=y1; y<=y2; y+=42, r^=1) pts.push(r?[x2,y]:[x1,y], r?[x1,y]:[x2,y]); return pts.map(p=>P(...p)) }

  let renderer, scene, camera, el, labelsEl, floors = {}, lights = {}, bulbs = {}, coffee, sel = null;
  let robot, brush, robotLed, vac = null, washer, washerX = 0, drum, drumGlass, steam = [], tvScreen, tvLight, tvGlow, anim = {washer:false, coffee:false, tv:false};
  const clock = new THREE.Clock();
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
    for(const w of INNER) box(...w, INNER_H, '#f4f5f8');
    for(const w of WINDOWS){
      box(...w, .25, '#fbfbfd');
      const g = box(w[0]+14,w[1],w[2]-14,w[3], WALL_H-.25, '#a9c6ee', .25, {transparent:true, opacity:.35, roughness:.1});
      g.castShadow = false;
    }
    for(const f of FURN) box(...f);
    const [cx1,cy1,ch] = DEVICE_SPOTS.coffee;
    coffee = box(cx1,cy1,cx1+26,cy1+28,.32,'#2a2d38',ch,{emissive:0x000000});
    // filiżanka i para nad ekspresem
    box(cx1+6,cy1+30,cx1+18,cy1+42,.07,'#ffffff',ch);
    const [sx,sz] = P(cx1+12, cy1+36);
    for(let i=0;i<5;i++){
      const p = new THREE.Mesh(new THREE.SphereGeometry(.035+i*.004, 10, 8), new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0, depthWrite:false}));
      p.userData = {phase:i/5, x:sx, z:sz, base:ch+.1}; p.visible = false; scene.add(p); steam.push(p);
    }
    // pralka z drzwiczkami i bębnem
    washer = box(940,662,1020,738,.85,'#f2f3f5');
    washerX = washer.position.x;
    const [wx,wz] = P(980, 738);
    const door = new THREE.Group(); door.position.set(wx - washerX, .42 - washer.position.y, wz - washer.position.z + .006);
    door.add(new THREE.Mesh(new THREE.TorusGeometry(.2,.03,10,32), new THREE.MeshStandardMaterial({color:0xb9c0cc, roughness:.4, metalness:.3})));
    drumGlass = new THREE.Mesh(new THREE.CircleGeometry(.18,32), new THREE.MeshStandardMaterial({color:0x8fa6c4, roughness:.25, emissive:0x000000}));
    door.add(drumGlass);
    drum = new THREE.Group(); drum.position.z = .004;
    [['#e4572e',.1,0],['#2a55c9',.1,2.1],['#f2c94c',.1,4.2],['#ffffff',.05,1]].forEach(([c,r,a]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(.07,.05,.01), new THREE.MeshBasicMaterial({color:c}));
      m.position.set(Math.cos(a)*r, Math.sin(a)*r, 0); m.rotation.z = a; drum.add(m);
    });
    door.add(drum); washer.add(door);
    // telewizor na szafce RTV, ekranem do sofy
    const [tx,tz] = P(330, 487);
    const tvBody = new THREE.Mesh(new THREE.BoxGeometry(1.15,.6,.05), new THREE.MeshStandardMaterial({color:0x15171d, roughness:.5}));
    tvBody.position.set(tx, .45 + .06 + .3, tz); tvBody.castShadow = true; scene.add(tvBody);
    tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.08,.53), new THREE.MeshBasicMaterial({color:0x0b0d12}));
    tvScreen.position.set(tx, tvBody.position.y, tz - .027); tvScreen.rotation.y = Math.PI; scene.add(tvScreen);
    // robot sprzątający ze stacją w przedpokoju
    box(1000,585,1028,628,.16,'#0e1f45');
    robot = new THREE.Group();
    const R = .24;
    const halo = new THREE.Mesh(new THREE.CircleGeometry(R*1.9, 40), new THREE.MeshBasicMaterial({color:0x3d7bff, transparent:true, opacity:0, depthWrite:false}));
    halo.rotation.x = -Math.PI/2; halo.position.y = .025; robot.add(halo); robot.userData.halo = halo;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(R,R,.1,36), new THREE.MeshStandardMaterial({color:0x0e1f45, roughness:.35, metalness:.2}));
    body.position.y = .07; body.castShadow = true; robot.add(body);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R*.98,.012,8,40), new THREE.MeshBasicMaterial({color:0x8fb0ff}));
    rim.rotation.x = Math.PI/2; rim.position.y = .12; robot.add(rim);
    const lidar = new THREE.Mesh(new THREE.CylinderGeometry(.065,.065,.045,24), new THREE.MeshStandardMaterial({color:0xdce6f8, roughness:.3}));
    lidar.position.set(0,.14,-.08); robot.add(lidar);
    robotLed = new THREE.Mesh(new THREE.SphereGeometry(.025,12,10), new THREE.MeshBasicMaterial({color:0x22a06b}));
    robotLed.position.set(0,.125,.13); robot.add(robotLed);
    brush = new THREE.Group(); brush.position.set(R*.72,.03,R*.72);
    for(let i=0;i<3;i++){ const b = new THREE.Mesh(new THREE.BoxGeometry(.16,.008,.014), new THREE.MeshBasicMaterial({color:0x8fb0ff})); b.rotation.y = i*2.09; b.position.set(Math.cos(i*2.09)*.04,0,-Math.sin(i*2.09)*.04); brush.add(b) }
    robot.add(brush);
    const [dx,dz] = P(...VAC_DOCK); robot.position.set(dx, 0, dz); robot.rotation.y = Math.PI/2; scene.add(robot);
    vac = {mode:'idle', zone:null, route:[], loop:[], flip:false};
    tvLight = new THREE.PointLight(0x6f8cff, 0, 3, 1.8); tvLight.position.set(tx, .8, tz - .6); scene.add(tvLight);
    // podświetlenie za telewizorem — widać, że gra, nawet od tyłu
    tvGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.5,.85), new THREE.MeshBasicMaterial({color:0x6f8cff, transparent:true, opacity:0, depthWrite:false}));
    tvGlow.position.set(tx, tvBody.position.y, tz + .04); scene.add(tvGlow);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(1.0,.45), new THREE.MeshBasicMaterial({color:0x0b0d12}));
    back.position.set(tx, tvBody.position.y, tz + .027); scene.add(back); tvGlow.userData.back = back;

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
  const animating = () => anim.washer || anim.coffee || anim.tv || (vac && vac.mode !== 'idle');
  function setVacuum(zone){
    if(!vac) return;
    const here = [robot.position.x, robot.position.z];
    if(zone && zone !== vac.zone){
      const Z = VAC_ZONES[zone]; if(!Z) return;
      const back = vac.zone ? [...VAC_ZONES[vac.zone].via].reverse().map(p=>P(...p)) : [];
      vac.loop = zigzag(Z.rect); vac.flip = false;
      vac.route = [...back, ...Z.via.map(p=>P(...p)), vac.loop[0]];
      vac.mode = 'going'; vac.zone = zone;
    } else if(!zone && vac.mode !== 'idle' && vac.mode !== 'returning'){
      const Z = VAC_ZONES[vac.zone];
      vac.route = [...(Z ? [...Z.via].reverse().map(p=>P(...p)) : []), P(...VAC_DOCK)];
      vac.mode = 'returning'; vac.zone = null;
    }
  }
  function moveRobot(dt){
    if(!vac || vac.mode === 'idle') return;
    brush.rotation.y += dt*14;
    let left = VAC_SPEED*dt;
    while(left > 0){
      if(!vac.route.length){
        if(vac.mode === 'returning'){ vac.mode = 'idle'; robotLed.material.color.set(0x22a06b); kick(); return }
        vac.mode = 'cleaning'; vac.flip = !vac.flip;
        vac.route = vac.flip ? [...vac.loop].reverse() : [...vac.loop];
      }
      const [tx,tz] = vac.route[0], dx = tx - robot.position.x, dz = tz - robot.position.z, d = Math.hypot(dx,dz);
      if(d < 1e-4){ vac.route.shift(); continue }
      const want = Math.atan2(dx, dz);
      let diff = want - robot.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      robot.rotation.y += Math.max(-dt*7, Math.min(dt*7, diff));
      const stepLen = Math.min(left, d);
      robot.position.x += dx/d*stepLen; robot.position.z += dz/d*stepLen; left -= stepLen;
      if(stepLen >= d) vac.route.shift();
    }
  }
  function step(){
    const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
    moveRobot(dt);
    if(robot){ const h = robot.userData.halo; h.material.opacity = vac.mode === 'idle' ? 0 : .22 + Math.sin(t*5)*.1 }
    if(anim.washer){ drum.rotation.z -= dt*9; washer.position.x = washerX + Math.sin(t*55)*.006 }
    if(anim.coffee) for(const p of steam){
      const f = (t*.45 + p.userData.phase) % 1;
      p.position.set(p.userData.x + Math.sin((t+p.userData.phase*6)*2.2)*.03, p.userData.base + f*.5, p.userData.z);
      p.material.opacity = Math.sin(Math.PI*f)*.55; p.scale.setScalar(.7 + f*1.1);
    }
    if(anim.tv){
      const h = (t*.06) % 1, c = new THREE.Color().setHSL(h, .65, .55 + Math.sin(t*3.1)*.06);
      tvScreen.material.color.copy(c); tvLight.color.copy(c); tvLight.intensity = 1.6 + Math.sin(t*4.3)*.35;
      tvGlow.material.color.copy(c); tvGlow.material.opacity = .5 + Math.sin(t*4.3)*.12;
      tvGlow.userData.back.material.color.copy(c).multiplyScalar(.75);
    }
  }
  function loop(){
    raf = 0;
    const moving = needs, a = animating();
    if(!moving && !a) return;
    needs = false;
    if(a) step(); else clock.getDelta();
    camera.position.set(target.x + dist*Math.sin(pol)*Math.sin(az), target.y + dist*Math.cos(pol), target.z + dist*Math.sin(pol)*Math.cos(az));
    camera.lookAt(target);
    renderer.render(scene, camera);
    if(moving) placeLabels();
    if(a) raf = requestAnimationFrame(loop);
  }
  function placeLabels(){
    const W = el.clientWidth, H = el.clientHeight, PAD = 8, TOP = 52;
    const items = [...labelsEl.children].map(lab => {
      const k = lab.dataset.room, [x,z] = P(...ROOMS[k].light);
      const v = new THREE.Vector3(x, .4, z).project(camera);
      return {lab, w:lab.offsetWidth, h:lab.offsetHeight, x:(v.x+1)/2*W, y:(1-v.y)/2*H};
    }).sort((a,b) => a.y - b.y);
    const placed = [];
    for(const it of items){
      // nie wychodź poza kartę i nie wchodź na licznik u góry
      it.x = Math.min(W - it.w/2 - PAD, Math.max(it.w/2 + PAD, it.x));
      it.y = Math.min(H - it.h/2 - PAD, Math.max(TOP + it.h/2, it.y));
      // rozsuń etykiety, które na siebie nachodzą
      for(let n = 0; n < 6; n++){
        const hit = placed.find(p => Math.abs(p.x - it.x) < (p.w + it.w)/2 + 4 && Math.abs(p.y - it.y) < (p.h + it.h)/2 + 4);
        if(!hit) break;
        const down = hit.y + (hit.h + it.h)/2 + 4;
        if(down + it.h/2 <= H - PAD) it.y = down;
        else it.y = hit.y - (hit.h + it.h)/2 - 4;
      }
      placed.push(it);
      it.lab.style.transform = `translate(${it.x}px, ${it.y}px) translate(-50%,-50%)`;
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
    anim = {washer:!!state.washer, coffee:!!state.coffee, tv:!!state.tv};
    setVacuum(state.vacuum || null);
    if(state.vacuum) robotLed.material.color.set(0x3d7bff);
    for(const p of steam) p.visible = anim.coffee;
    if(!anim.washer) washer.position.x = washerX;
    drumGlass.material.emissive.set(anim.washer ? 0x3d6fd6 : 0x000000); drumGlass.material.emissiveIntensity = .35;
    if(!anim.tv){ tvScreen.material.color.set(0x0b0d12); tvLight.intensity = 0; tvGlow.material.opacity = 0; tvGlow.userData.back.material.color.set(0x15171d) }
    for(const lab of labelsEl.children){
      const st = state.rooms[lab.dataset.room] || {};
      lab.textContent = st.label || '';
      lab.classList.toggle('on', !!st.on); lab.classList.toggle('sel', lab.dataset.room === state.selected);
    }
    needs = true; kick();
  }

  window.Home3D = { build, update, kick, resize };
})();
