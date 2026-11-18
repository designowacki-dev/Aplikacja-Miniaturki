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
  let goal = null, focused = undefined;   // płynny najazd kamery na wybrany pokój
  const DIST_ALL = 18.5, DIST_ROOM = 9.5;
  const target = new THREE.Vector3(0, 0, 0.25);

  function box(x1,y1,x2,y2,h,color,y0=0,opts={}){
    const [ax,az1] = P(x1,y1), [bx,bz] = P(x2,y2);
    const g = new THREE.BoxGeometry(Math.abs(bx-ax), h, Math.abs(bz-az1));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({color, roughness:.85, metalness:0, ...opts}));
    m.position.set((ax+bx)/2, y0 + h/2, (az1+bz)/2);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m); return m;
  }


  /* ── tekstury rysowane w przeglądarce (bez plików graficznych) ── */
  const TEX = {};
  function canvasTex(key, w, h, draw){
    if(TEX[key]) return TEX[key];
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    return TEX[key] = t;
  }
  const rnd = (a,b) => a + Math.random()*(b-a);
  const oakTex = () => canvasTex('oak', 512, 512, (g,w,h) => {        // jasny dąb, deski
    const rows = 8, rh = h/rows;
    for(let r=0; r<rows; r++){
      const off = (r*157) % (w/2);
      for(let x=-off; x<w; x+=w/2){
        g.fillStyle = `hsl(${rnd(30,36)},${rnd(40,50)}%,${rnd(70,76)}%)`; g.fillRect(x, r*rh, w/2, rh);
        for(let i=0;i<16;i++){ const yy = r*rh + rnd(2,rh-2); g.strokeStyle = `rgba(130,85,40,${rnd(.04,.1)})`; g.lineWidth = rnd(.6,1.4);
          g.beginPath(); g.moveTo(x,yy); g.bezierCurveTo(x+w*.15,yy+rnd(-3,3),x+w*.35,yy+rnd(-3,3),x+w/2,yy+rnd(-1,1)); g.stroke() }
        g.fillStyle = 'rgba(95,62,30,.28)'; g.fillRect(x, r*rh, 2, rh);
      }
      g.fillStyle = 'rgba(95,62,30,.25)'; g.fillRect(0, r*rh, w, 2);
    }
  });
  const walnutTex = () => canvasTex('walnut', 256, 512, (g,w,h) => {   // fronty kuchni i łazienki
    g.fillStyle = '#a4673a'; g.fillRect(0,0,w,h);
    for(let i=0;i<70;i++){ const x = rnd(0,w); g.strokeStyle = `rgba(${rnd(60,110)|0},${rnd(30,55)|0},15,${rnd(.08,.22)})`; g.lineWidth = rnd(.6,2.4);
      g.beginPath(); g.moveTo(x,0); g.bezierCurveTo(x+rnd(-12,12),h*.33,x+rnd(-12,12),h*.66,x+rnd(-6,6),h); g.stroke() }
  });
  const boucleTex = () => canvasTex('boucle', 256, 256, (g,w,h) => {   // bouclé
    g.fillStyle = '#ffffff'; g.fillRect(0,0,w,h);
    for(let i=0;i<5200;i++){ const v = rnd(205,255)|0; g.fillStyle = `rgba(${v},${v-3},${v-8},.75)`; g.beginPath(); g.arc(rnd(0,w),rnd(0,h),rnd(.6,1.9),0,7); g.fill() }
  });
  const concreteTex = () => canvasTex('concrete', 256, 256, (g,w,h) => {
    g.fillStyle = '#bdb8b0'; g.fillRect(0,0,w,h);
    for(let i=0;i<2600;i++){ const v = rnd(150,215)|0; g.fillStyle = `rgba(${v},${v-2},${v-6},.5)`; g.fillRect(rnd(0,w),rnd(0,h),rnd(1,3),rnd(1,3)) }
  });
  const tileTex = () => canvasTex('tile', 256, 256, (g,w,h) => {       // jasne płytki łazienkowe z żyłkami
    g.fillStyle = '#ecebe8'; g.fillRect(0,0,w,h);
    for(let i=0;i<7;i++){ g.strokeStyle = `rgba(150,140,125,${rnd(.15,.3)})`; g.lineWidth = rnd(.5,1.4); g.beginPath(); let x = rnd(0,w), y = 0; g.moveTo(x,y);
      while(y < h){ x += rnd(-18,18); y += rnd(12,30); g.lineTo(x,y) } g.stroke() }
    g.strokeStyle = 'rgba(160,160,160,.55)'; g.lineWidth = 2; g.strokeRect(0,0,w,h);
  });
  const M = {};
  const mat = (key, o) => M[key] || (M[key] = new THREE.MeshStandardMaterial(o));
  const W = () => mat('white',   {color:0xf4f3f0, roughness:.55});
  const BOUCLE = () => mat('boucle', {color:0xeee8de, roughness:.95, map:boucleTex()});
  const WALNUT = () => mat('walnut', {color:0xffffff, roughness:.6, map:walnutTex()});
  const OAK = () => mat('oak',      {color:0xe9d4b4, roughness:.7});
  const BLACK = () => mat('black',  {color:0x15161a, roughness:.25, metalness:.2});
  const METAL = () => mat('metal',  {color:0xc9ccd1, roughness:.25, metalness:.85});
  const GLASS = () => mat('glass',  {color:0xcfe3f2, roughness:.05, transparent:true, opacity:.28});

  function rrShape(w,h,r){
    const s = new THREE.Shape(), x = -w/2, y = -h/2; r = Math.max(.0005, Math.min(r, w/2, h/2));
    s.moveTo(x+r,y); s.lineTo(x+w-r,y); s.quadraticCurveTo(x+w,y,x+w,y+r); s.lineTo(x+w,y+h-r); s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    s.lineTo(x+r,y+h); s.quadraticCurveTo(x,y+h,x,y+h-r); s.lineTo(x,y+r); s.quadraticCurveTo(x,y,x+r,y); return s;
  }
  function rboxGeo(w,h,d,r){                                          // prostopadłościan z miękko zaokrąglonymi krawędziami
    r = Math.max(.004, Math.min(r, w/2-.002, h/2-.002, d/2-.002));
    const bs = r*.75;
    const g = new THREE.ExtrudeGeometry(rrShape(w-2*bs, h-2*bs, r*.5), {depth:Math.max(.002, d-2*bs), bevelEnabled:true, bevelThickness:bs, bevelSize:bs, bevelSegments:3, curveSegments:5});
    g.center(); return g;
  }
  function put(mesh, xpx, ypx, y){ const [x,z] = P(xpx,ypx); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh); return mesh }
  const bx = (x1,y1,x2,y2,h,y0,m) => put(new THREE.Mesh(new THREE.BoxGeometry((x2-x1)*S, h, (y2-y1)*S), m), (x1+x2)/2, (y1+y2)/2, y0 + h/2);
  const rb = (x1,y1,x2,y2,h,y0,r,m) => put(new THREE.Mesh(rboxGeo((x2-x1)*S, h, (y2-y1)*S, r), m), (x1+x2)/2, (y1+y2)/2, y0 + h/2);
  let lampShade, lampLight, counterLed;

  function buildFurniture(){
    /* ── SALON: narożnik bouclé z szezlongiem po lewej ── */
    rb(176,166,456,204,.42,0,.06,BOUCLE());                                   // podstawa oparcia
    for(let x=290; x<438; x+=37) rb(x+1,200,x+36,280,.38,.02,.11,BOUCLE());   // pikowane „wałki” siedziska
    for(let x=176; x<290; x+=38) for(const [y1,y2] of [[200,282],[282,362]]) rb(x+1,y1,x+37,y2,.38,.02,.11,BOUCLE()); // szezlong
    rb(436,168,462,282,.58,0,.11,BOUCLE());                                   // podłokietnik prawy
    rb(172,168,196,214,.58,0,.1,BOUCLE());                                    // podłokietnik lewy (za szezlongiem)
    for(const [x1,x2] of [[196,316],[316,436]]){ const c = rb(x1+1,170,x2-1,208,.44,.4,.13,BOUCLE()); c.rotation.x = -.14 }   // poduchy oparcia
    rb(318,290,410,350,.34,0,.03,OAK());                                      // stolik kawowy
    rb(245,466,415,504,.42,0,.02,WALNUT());                                   // szafka RTV

    /* ── JADALNIA: okrągły stół (beton + biała noga) i 4 krzesła ── */
    const [tcx,tcy] = [598,430];
    const top = new THREE.Mesh(new THREE.CylinderGeometry(.6,.6,.035,56), mat('concrete',{color:0xffffff, roughness:.9, map:concreteTex()}));
    put(top, tcx, tcy, .757);
    put(new THREE.Mesh(new THREE.CylinderGeometry(.19,.36,.74,48), mat('cone',{color:0xf3f1ec, roughness:.6})), tcx, tcy, .37);
    const CH_WOOD = mat('chairwood',{color:0x5a3a26, roughness:.55});
    const CH_FAB = mat('chairfab',{color:0xd6d2cb, roughness:.95, map:boucleTex()});
    for(const [dx,dy] of [[-53,-53],[53,-53],[-53,53],[53,53]]){
      const g = new THREE.Group();
      const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x,y,z); o.castShadow = true; g.add(o); return o };
      for(const sx of [-.23,.23]){
        add(new THREE.BoxGeometry(.055,.66,.06), CH_WOOD, sx, .33, .19);       // przednia noga + podłokietnik
        add(new THREE.BoxGeometry(.055,.66,.06), CH_WOOD, sx, .33, -.19);
        add(new THREE.BoxGeometry(.055,.06,.44), CH_WOOD, sx, .66, 0);
      }
      add(new THREE.BoxGeometry(.52,.06,.06), CH_WOOD, 0, .66, -.2);           // tył ramy
      add(new THREE.BoxGeometry(.13,.62,.05), CH_WOOD, 0, .31, -.2);           // środkowa listwa oparcia
      add(rboxGeo(.42,.08,.42,.04), CH_FAB, 0, .47, .01);                      // siedzisko
      add(rboxGeo(.42,.15,.07,.035), CH_FAB, 0, .76, -.2);                     // poducha oparcia
      const [cx,cz] = P(tcx+dx, tcy+dy), [tx,tz] = P(tcx,tcy);
      g.position.set(cx, 0, cz); g.rotation.y = Math.atan2(tx-cx, tz-cz);
      scene.add(g);
    }

    /* ── KUCHNIA: drewniane szafki, biały blat, czarna płyta, zlew i piekarnik ── */
    bx(668,163,958,219,.08,0,mat('plinth',{color:0x3a2a1e, roughness:.8}));
    for(const [x1,x2] of [[665,725],[725,800],[800,880],[880,960]]) bx(x1+1,160,x2-1,222,.78,.08,WALNUT());
    for(const y of [.3,.52,.74]) bx(680,222,710,225,.015,y,METAL());           // uchwyty szuflad
    for(const [x1,x2] of [[800,880],[880,960]]) bx(x1+12,222,x2-12,225,.015,.8,METAL());
    bx(728,221,797,224,.58,.16,BLACK()); bx(736,224,789,227,.018,.68,METAL()); // piekarnik
    bx(663,157,962,227,.04,.86,mat('counter',{color:0xf7f6f3, roughness:.35}));   // blat
    bx(690,166,780,213,.006,.9,BLACK());                                       // płyta indukcyjna
    for(const [hx,hy,r] of [[708,180,.09],[708,200,.07],[760,180,.07],[760,200,.09]]){
      const ring = new THREE.Mesh(new THREE.RingGeometry(r*.7,r,32), mat('hobring',{color:0x3c4048, roughness:.3}));
      ring.rotation.x = -Math.PI/2; put(ring, hx, hy, .907);
    }
    bx(805,168,860,210,.01,.897,mat('sink',{color:0x202227, roughness:.4}));    // czarny zlew
    put(new THREE.Mesh(new THREE.CylinderGeometry(.012,.015,.3,12), METAL()), 832, 162, 1.05);
    bx(828,160,836,180,.02,1.19,METAL());                                      // wylewka baterii
    counterLed = bx(668,158,958,161,.012,.888,new THREE.MeshBasicMaterial({color:0x9a8f80}));   // listwa LED pod szafkami
    for(const [y1,y2] of [[227,283],[283,340]]) bx(962,y1+1,1028,y2-1,.78,.08,WALNUT());
    bx(958,262,961,278,.015,.8,METAL()); bx(958,300,961,320,.015,.8,METAL());
    bx(960,224,1030,342,.04,.86,mat('counter'));
    bx(962,342,1028,415,.97,.08,WALNUT());                                     // wysoka zabudowa (lodówka)
    bx(958,355,961,400,.02,.55,METAL());
    bx(665,155,960,158,.14,.9,mat('backsplash',{color:0xf2f1ee, roughness:.3})); // płytki nad blatem

    /* ── ŁAZIENKA: wanna z parawanem, podwieszane WC, szafka z umywalką ── */
    bx(686,661,765,838,.55,0,mat('tub',{color:0xfbfbfb, roughness:.15}));
    bx(694,670,757,830,.02,.54,mat('tubin',{color:0xe4ebf0, roughness:.1}));
    bx(764,662,767,762,.48,.56,GLASS()); bx(764,662,767,762,.015,1.03,METAL());
    bx(886,826,992,840,.95,0,mat('install',{color:0xf2f1ee, roughness:.4, map:tileTex()}));   // zabudowa WC
    bx(926,823,950,826,.1,.72,mat('flush',{color:0xc9cacc, roughness:.3, metalness:.4}));
    rb(898,772,932,826,.17,.27,.06,W()); rb(899,770,931,822,.03,.44,.015,W()); // miska WC
    bx(778,802,858,838,.3,.48,WALNUT());                                       // szafka podumywalkowa
    bx(800,800,836,803,.012,.6,METAL());
    bx(776,800,860,838,.03,.78,mat('counter'));
    rb(792,805,846,835,.1,.81,.04,W());                                        // umywalka nablatowa
    put(new THREE.Mesh(new THREE.CylinderGeometry(.01,.013,.2,10), METAL()), 820, 836, .92);
    bx(938,660,1022,740,.13,.92,WALNUT());                                     // szafka nad pralką

    /* ── SYPIALNIA: łóżko bouclé, stoliki, lampka, biurko, komoda z TV, monstera ── */
    bx(298,582,562,800,.01,.004,mat('rug',{color:0xd5c6b0, roughness:1, map:boucleTex()}));
    for(let x=330; x<525; x+=39) rb(x+1,600,x+38,642,.36,.02,.1,BOUCLE());    // „wałki” ramy w nogach
    for(const [x1,x2] of [[330,353],[502,525]]) for(let y=642; y<815; y+=35) rb(x1+1,y+1,x2-1,y+34,.36,.02,.09,BOUCLE());
    bx(353,642,502,815,.3,.02,BOUCLE());
    rb(344,612,511,812,.2,.32,.05,mat('mattress',{color:0xf8f6f1, roughness:.8}));
    rb(338,606,517,700,.035,.5,.015,mat('throw',{color:0xb9a790, roughness:1, map:boucleTex()}));   // narzuta
    rb(343,700,512,795,.06,.5,.03,mat('duvet',{color:0xf0eae0, roughness:1}));
    for(const [x1,x2,c] of [[346,396,0x9ea79c],[392,438,0x1f2d57],[436,484,0xbba890],[468,512,0x9ea79c]]) rb(x1,776,x2,812,.13,.52,.05,mat('pil'+c,{color:c, roughness:1}));
    for(let x=330; x<525; x+=39) for(const y0 of [.34,.75]) rb(x+1,815,x+38,838,.41,y0,.09,BOUCLE());   // pikowane wezgłowie 2×5
    bx(296,800,328,836,.48,0,OAK()); bx(527,800,549,836,.48,0,OAK());          // stoliki nocne
    put(new THREE.Mesh(new THREE.CylinderGeometry(.035,.05,.2,16), W()), 312, 818, .58);
    lampShade = put(new THREE.Mesh(new THREE.CylinderGeometry(.075,.1,.16,24,1,true), new THREE.MeshStandardMaterial({color:0xfaf6ee, roughness:.9, side:THREE.DoubleSide, emissive:0x000000})), 312, 818, .76);
    lampLight = new THREE.PointLight(0xffc27a, 0, 1.8, 2); { const [lx,lz] = P(312,818); lampLight.position.set(lx,.8,lz) } scene.add(lampLight);
    bx(142,529,262,585,.03,.72,W()); bx(142,529,147,585,.72,0,W()); bx(257,529,262,585,.72,0,W());   // białe biurko
    for(const mx of [176,229]){ bx(mx-26,533,mx+26,536,.3,.94,BLACK()); bx(mx-2,536,mx+2,540,.2,.75,METAL()) }   // dwa monitory
    bx(170,548,234,568,.012,.75,W());
    rb(184,594,222,630,.07,.44,.03,mat('dchair',{color:0xe2d7c6, roughness:.9})); rb(185,626,221,634,.3,.5,.04,mat('dchair'));
    put(new THREE.Mesh(new THREE.CylinderGeometry(.02,.02,.42,10), METAL()), 203, 612, .21);
    bx(385,529,505,571,.74,0,OAK());                                           // komoda
    for(const y of [.25,.55]) bx(425,571,465,574,.012,y,METAL());
    bx(410,531,482,535,.4,.8,BLACK()); bx(442,533,450,545,.06,.74,METAL());     // telewizor na komodzie w sypialni
    put(new THREE.Mesh(new THREE.CylinderGeometry(.15,.12,.34,24), mat('pot',{color:0xc8beb0, roughness:.95})), 540, 566, .17);   // donica
    const LEAF = mat('leaf',{color:0x2f6b3a, roughness:.7, side:THREE.DoubleSide});
    for(let i=0;i<8;i++){
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(.16,14,8), LEAF);
      leaf.scale.set(1,.06,.65);
      const a = i/8*Math.PI*2, [px,pz] = P(540,566);
      leaf.position.set(px + Math.cos(a)*.14, .52 + (i%3)*.09, pz + Math.sin(a)*.14);
      leaf.rotation.set(Math.sin(a)*.5, -a, Math.cos(a)*.5); leaf.castShadow = true; scene.add(leaf);
    }
    bx(550,645,665,835,.95,0,mat('wardrobe',{color:0xefebe5, roughness:.6}));   // szafa
    bx(546,700,549,780,.015,.6,METAL());

    /* ── PRZEDPOKÓJ ── */
    bx(847,432,1030,500,.95,0,mat('wardrobe'));
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
        const base = k === 'lazienka' ? tileTex() : oakTex(), t = base.clone(); t.needsUpdate = true;
        const tile = k === 'lazienka' ? .6 : 2.4;
        t.repeat.set((c-a)*S/tile, (d-b)*S/tile);
        const m = box(a,b,c,d,.02,'#ffffff',0,{map:t, roughness:k==='lazienka'?.35:.75});
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
    buildFurniture();
    const [cx1,cy1,ch] = DEVICE_SPOTS.coffee;   // blat na wysokości .9
    coffee = box(cx1,cy1,cx1+26,cy1+28,.32,'#2a2d38',ch,{emissive:0x000000});
    // filiżanka i para nad ekspresem
    box(cx1+6,cy1+30,cx1+18,cy1+42,.07,'#ffffff',ch);
    const [sx,sz] = P(cx1+12, cy1+36);
    for(let i=0;i<5;i++){
      const p = new THREE.Mesh(new THREE.SphereGeometry(.035+i*.004, 10, 8), new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0, depthWrite:false}));
      p.userData = {phase:i/5, x:sx, z:sz, base:ch+.1}; p.visible = false; scene.add(p); steam.push(p);
    }
    // pralka z drzwiczkami i bębnem
    washer = box(940,662,1020,738,.85,'#2c2d32',0,{roughness:.4, metalness:.15});
    washerX = washer.position.x;
    const [wx,wz] = P(980, 738);
    const door = new THREE.Group(); door.position.set(wx - washerX, .42 - washer.position.y, wz - washer.position.z + .006);
    door.add(new THREE.Mesh(new THREE.TorusGeometry(.2,.028,10,32), new THREE.MeshStandardMaterial({color:0x9aa0a8, roughness:.3, metalness:.6})));
    drumGlass = new THREE.Mesh(new THREE.CircleGeometry(.18,32), new THREE.MeshStandardMaterial({color:0x1d2330, roughness:.15, emissive:0x000000}));
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
      if(pts.size === 1){ az -= dx*.008; pol = Math.min(1.25, Math.max(.45, pol - dy*.006)); moved += Math.abs(dx)+Math.abs(dy); if(moved > 6) goal = null }
      else if(pts.size === 2){
        const [a,b] = [...pts.values()]; const d = Math.hypot(a.x-b.x, a.y-b.y);
        if(lastPinch) dist = Math.min(30, Math.max(5, dist * lastPinch / d)); lastPinch = d; moved = 99; goal = null;
      }
      kick();
    });
    const up = e => {
      if(pts.size === 1 && moved < 6) pick(e, onRoom);
      pts.delete(e.pointerId); if(pts.size < 2) lastPinch = 0;
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => { e.preventDefault(); dist = Math.min(30, Math.max(5, dist * (1 + e.deltaY*.001))); kick() }, {passive:false});
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
  const animating = () => anim.washer || anim.coffee || anim.tv || (vac && vac.mode !== 'idle') || !!goal;
  function focus(room){
    if(room === focused) return; focused = room;
    const R = room && ROOMS[room];
    let tx = 0, tz = .25, d = DIST_ALL, p = .86;
    if(R){ const xs = R.rects.flatMap(r=>[r[0],r[2]]), ys = R.rects.flatMap(r=>[r[1],r[3]]);
      [tx,tz] = P((Math.min(...xs)+Math.max(...xs))/2, (Math.min(...ys)+Math.max(...ys))/2);
      const span = Math.max(Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys))*S;
      d = Math.max(7.5, Math.min(DIST_ROOM + 2, span*1.6 + 3.2)); p = .5 }   // pokój: widok bardziej z góry, żeby ściany nie zasłaniały
    goal = {x:tx, z:tz, d, p};
  }
  function stepCamera(dt){
    if(!goal) return;
    const k = 1 - Math.pow(.004, dt);   // wygładzenie
    target.x += (goal.x-target.x)*k; target.z += (goal.z-target.z)*k; dist += (goal.d-dist)*k; pol += (goal.p-pol)*k;
    if(Math.abs(goal.x-target.x) + Math.abs(goal.z-target.z) + Math.abs(goal.d-dist) + Math.abs(goal.p-pol) < .01){ target.x = goal.x; target.z = goal.z; dist = goal.d; pol = goal.p; goal = null }
    needs = true;
  }
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
    moveRobot(dt); stepCamera(dt);
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
      // pokój poza kadrem (np. po przybliżeniu innego) — chowamy etykietę zamiast wciskać ją w róg
      const off = it.x < -10 || it.x > W + 10 || it.y < TOP - 20 || it.y > H + 10;
      it.lab.style.visibility = off ? 'hidden' : '';
      if(off) continue;
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
        else if(st.on){ f.material.emissive.set(0xffa53a); f.material.emissiveIntensity = .05 + lvl*.1 }
        else f.material.emissive.set(0x000000);
      }
    }
    coffee.material.emissive.set(state.coffee ? 0xff8a3c : 0x000000); coffee.material.emissiveIntensity = .7;
    anim = {washer:!!state.washer, coffee:!!state.coffee, tv:!!state.tv};
    lampShade.material.emissive.set(state.lamp ? 0xffb35c : 0x000000); lampShade.material.emissiveIntensity = .9;
    lampLight.intensity = state.lamp ? 1.4 : 0;
    counterLed.material.color.set(state.counterLight ? 0xfff1d6 : 0x9a8f80);
    setVacuum(state.vacuum || null);
    focus(state.selected || null);
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
