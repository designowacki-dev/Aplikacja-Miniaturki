/* Model 3D mieszkania odtworzony z rzutu (1 px rzutu ≈ 1 cm).
   Pokoje: salon z aneksem (1), sypialnia (2), łazienka (3), przedpokój (4).
   Ściany przycięte na ~1 m (widok „domek dla lalek”), światła w pokojach reagują na stan urządzeń. */
(function(){
  const S = 0.0084;          // px → metry (skala wyliczona z powierzchni pokoi w protokole: łazienka 4,16 m², pokój 12,10 m²)
  const CX = 567, CY = 508;  // środek rzutu
  const WALL_H = 1.05;       // ściany od strony kamery — ucięte
  const TALL_H = 2.45;       // ściany z tyłu kadru — pełna wysokość (widać szafki górne, płytki, lustro)
  const WALL_C = '#d6d6d3';  // NCS S 1500-N jasny szary
  const P = (x, y) => [(x - CX) * S, (y - CY) * S];

  // ściany zewnętrzne pogrupowane wg strony (do przekroju zależnego od kamery)
  const SIDES = {
    north:{n:[0,-1], walls:[[80,128,1055,155]]},
    south:{n:[0, 1], walls:[[80,840,1055,888]]},
    west: {n:[-1,0], walls:[[80,128,125,255],[80,460,125,600],[80,765,125,888]]},
    east: {n:[ 1,0], walls:[[1030,128,1055,520],[1030,635,1055,888]]},
  };
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
  const DEVICE_SPOTS = { coffee:[928,166,.9] };   // ekspres na narożnym blacie
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
  let az = -0.5, pol = 0.86, dist = 15.5, needs = true, raf = 0;
  const side = {};   // grupy elementów powyżej 1,05 m dla każdej ściany zewnętrznej
  /* ── tryb „w środku pokoju”: widok z wysokości oczu i sterowanie z wnętrza ── */
  const EYE_H = 1.55;
  const VIEWS = {   // [punkt stania na rzucie, kierunek patrzenia]
    salon:     {at:[905,305], yaw:-1.72, fov:72},
    sypialnia: {at:[690,585], yaw:-1.2,  fov:72},
    lazienka:  {at:[930,698], yaw:-.85,  fov:84},
    przedpokoj:{at:[995,565], yaw:-1.5,  fov:74},
  };
  const ANCHORS = {   // gdzie w pokoju pokazać przycisk urządzenia [x, y na rzucie, wysokość]
    'dev-salon-light':[560,300,2.25], 'dev-kuchnia-light':[810,190,1.4], 'dev-ekspres':[941,180,1.18], 'dev-tv':[330,487,.82],
    'dev-sypialnia-light':[400,690,2.25], 'dev-lampka':[312,818,.9],
    'dev-lazienka-light':[860,750,2.25], 'dev-pralka':[980,700,.62],
    'dev-przedpokoj-light':[800,575,2.25],
  };
  let mode = 'outside', insideRoom = null, saved = null, tween = null, hemi;
  let yaw = 0, pitch = -.1, fov = 30;
  const eye = new THREE.Vector3(), lookPt = new THREE.Vector3(0,0,.25);
  let ceilingG, innerUp, hotsEl, onTapDev = null;
  let goal = null, focused = undefined;   // płynny najazd kamery na wybrany pokój
  const DIST_ALL = 15.5, DIST_ROOM = 8;
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
  const oakTex = () => canvasTex('ash', 512, 512, (g,w,h) => {        // Egger Classic Aqua Jesion Avio naturalny, deski 129,2×19,3 cm
    const rows = 8, rh = h/rows;
    for(let r=0; r<rows; r++){
      const off = (r*157) % (w/2);
      for(let x=-off; x<w; x+=w/2){
        g.fillStyle = `hsl(${rnd(33,38)},${rnd(26,34)}%,${rnd(74,79)}%)`; g.fillRect(x, r*rh, w/2, rh);
        for(let i=0;i<16;i++){ const yy = r*rh + rnd(2,rh-2); g.strokeStyle = `rgba(120,95,65,${rnd(.04,.1)})`; g.lineWidth = rnd(.6,1.4);
          g.beginPath(); g.moveTo(x,yy); g.bezierCurveTo(x+w*.15,yy+rnd(-3,3),x+w*.35,yy+rnd(-3,3),x+w/2,yy+rnd(-1,1)); g.stroke() }
        g.fillStyle = 'rgba(95,75,50,.25)'; g.fillRect(x, r*rh, 2, rh);
      }
      g.fillStyle = 'rgba(95,75,50,.22)'; g.fillRect(0, r*rh, w, 2);
    }
  });
  const walnutTex = () => canvasTex('walnut', 256, 512, (g,w,h) => {   // fronty kuchni i łazienki
    g.fillStyle = '#9b6b43'; g.fillRect(0,0,w,h);   // Egger H1386 ST40 Dąb Casella brązowy
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
  const largeTile = (key, base, veins) => canvasTex(key, 256, 512, (g,w,h) => {   // płytka 60×120 z fugą
    g.fillStyle = base; g.fillRect(0,0,w,h);
    for(let i=0;i<veins;i++){ g.strokeStyle = `rgba(150,140,125,${rnd(.06,.14)})`; g.lineWidth = rnd(.5,1.2); g.beginPath(); let x = rnd(0,w), y = 0; g.moveTo(x,y);
      while(y < h){ x += rnd(-14,14); y += rnd(14,34); g.lineTo(x,y) } g.stroke() }
    g.strokeStyle = 'rgba(150,150,150,.6)'; g.lineWidth = 2; g.strokeRect(0,0,w,h);
  });
  const munichTex = () => largeTile('munich', '#efefed', 2);   // Cifre Munich White mat — podłoga łazienki
  const acronTex  = () => largeTile('acron',  '#e8e1d2', 3);   // Cifre Acron Ivory mat — korytarz
  const veniceTex = () => largeTile('venice', '#ebe5d9', 6);   // Ceramica Limone Venice Ivory mat — ściany łazienki
  const brickTex = () => canvasTex('brick', 256, 256, (g,w,h) => {   // Paradyż Monpelli White Mix cegiełka 29,8×6,5 połysk
    g.fillStyle = '#c9c7c2'; g.fillRect(0,0,w,h);
    const bw = w/2, bh = h/9;
    for(let r=0; r<9; r++) for(let c=-1; c<3; c++){ const x = c*bw + (r%2 ? bw/2 : 0) + 1.5, y = r*bh + 1.5;
      g.fillStyle = `hsl(40,${rnd(5,12)}%,${rnd(93,98)}%)`; g.fillRect(x, y, bw-3, bh-3) }
  });
  const graniteTex = () => canvasTex('granite', 256, 256, (g,w,h) => {   // Egger F486 Granit lśniący biały
    g.fillStyle = '#f5f4f1'; g.fillRect(0,0,w,h);
    for(let i=0;i<1800;i++){ const v = rnd(150,230)|0; g.fillStyle = `rgba(${v},${v},${v-4},.6)`; g.fillRect(rnd(0,w),rnd(0,h),rnd(.6,2),rnd(.6,2)) }
  });
  const tileTex = () => canvasTex('tile', 256, 256, (g,w,h) => {       // jasne płytki łazienkowe z żyłkami
    g.fillStyle = '#ecebe8'; g.fillRect(0,0,w,h);
    for(let i=0;i<7;i++){ g.strokeStyle = `rgba(150,140,125,${rnd(.15,.3)})`; g.lineWidth = rnd(.5,1.4); g.beginPath(); let x = rnd(0,w), y = 0; g.moveTo(x,y);
      while(y < h){ x += rnd(-18,18); y += rnd(12,30); g.lineTo(x,y) } g.stroke() }
    g.strokeStyle = 'rgba(160,160,160,.55)'; g.lineWidth = 2; g.strokeRect(0,0,w,h);
  });
  // materiał z teksturą płytek w prawdziwej skali (tile w × h w metrach) dla konkretnej powierzchni
  function tiled(key, texFn, tileW, tileH, len, h, extra={}){
    const k = `${key}:${len.toFixed(2)}x${h.toFixed(2)}`;
    if(M[k]) return M[k];
    const t = texFn().clone(); t.needsUpdate = true; t.repeat.set(len/tileW, h/tileH);
    return M[k] = new THREE.MeshStandardMaterial({color:0xffffff, map:t, ...extra});
  }
  const M = {};
  const mat = (key, o) => M[key] || (M[key] = new THREE.MeshStandardMaterial(o));
  const W = () => mat('white',   {color:0xf4f3f0, roughness:.55});
  const BOUCLE = () => mat('boucle', {color:0xeee8de, roughness:.95, map:boucleTex()});
  const WALNUT = () => mat('walnut', {color:0xffffff, roughness:.6, map:walnutTex()});
  const OAK = () => mat('oak',      {color:0xe9d4b4, roughness:.7});
  const BLACK = () => mat('black',  {color:0x15161a, roughness:.25, metalness:.2});
  const METAL = () => mat('metal',  {color:0xd5d9de, roughness:.22, metalness:.35});   // chrom (bez mapy otoczenia pełny metal wychodzi czarny)
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
  // elementy powyżej 1,05 m przy danej ścianie trafiają do jej grupy (chowanej, gdy ściana jest od strony kamery)
  function toSide(name, mesh){ scene.remove(mesh); side[name].add(mesh); return mesh }
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
    const [tcx,tcy] = [598,436];
    const top = new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,.035,56), mat('concrete',{color:0xffffff, roughness:.9, map:concreteTex()}));
    put(top, tcx, tcy, .757);
    put(new THREE.Mesh(new THREE.CylinderGeometry(.19,.36,.74,48), mat('cone',{color:0xf3f1ec, roughness:.6})), tcx, tcy, .37);
    const CH_WOOD = mat('chairwood',{color:0x5a3a26, roughness:.55});
    const CH_FAB = mat('chairfab',{color:0xd6d2cb, roughness:.95, map:boucleTex()});
    for(const a of [-150,-30,30,150].map(d=>d*Math.PI/180)){
      const dx = Math.cos(a)*.74/S, dy = Math.sin(a)*.74/S;
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

    /* ── KUCHNIA (protokół): fronty dolne Dąb Casella, górne Szary Taupe, blat Granit lśniący biały,
          płytki Monpelli cegiełka, zlew Franke Orion czarny, Bosch: płyta i piekarnik czarne, okap srebrny, lodówka w zabudowie ── */
    const TAUPE = mat('taupe',{color:0xb9afa3, roughness:.5});              // Egger U750 Szary Taupe
    const GRANITE = mat('granite',{color:0xffffff, roughness:.3, map:graniteTex()});
    const BRICK = (len, h) => tiled('brick', brickTex, .6, .585, len, h, {roughness:.15});
    const rail = (x,y,h,vertical) => vertical ? bx(x-1.5,y-9,x+1.5,y+9,.012,h,METAL()) : bx(x-9,y-1.5,x+9,y+1.5,.012,h,METAL());  // reling 128 mm
    bx(668,163,958,219,.08,0,mat('plinth',{color:0x3a2a1e, roughness:.8}));
    for(const [x1,x2] of [[665,725],[725,796],[796,850],[850,921],[921,960]]) bx(x1+1,160,x2-1,222,.78,.08,WALNUT());
    for(const y of [.32,.55,.78]) bx(686,222,704,225,.012,y,METAL());       // szuflady
    rail(823,223.5,.78); rail(885,223.5,.78); rail(940,223.5,.78);            // zmywarka 45 cm, zlewozmywak, narożna
    bx(727,221,794,224,.58,.16,BLACK()); bx(735,224,786,227,.018,.68,METAL()); // piekarnik Bosch Serie 4 czarny
    bx(663,157,962,228,.038,.862,GRANITE);                                   // blat 38 mm
    bx(727,163,794,220,.006,.9,BLACK());                                     // płyta indukcyjna 60×60 czarna
    for(const [hx,hy,r] of [[745,178,.085],[745,205,.065],[776,178,.065],[776,205,.085]]){
      const ring = new THREE.Mesh(new THREE.RingGeometry(r*.72,r,32), mat('hobring',{color:0x3c4048, roughness:.3}));
      ring.rotation.x = -Math.PI/2; put(ring, hx, hy, .907);
    }
    const SINK = mat('sink',{color:0x1d1e21, roughness:.45});               // Franke Orion OID 611-62 Onyx Tectonite
    bx(852,166,886,214,.012,.892,SINK); bx(886,166,919,214,.006,.9,SINK);
    for(let x=890; x<917; x+=5) bx(x,170,x+1.5,210,.002,.906,mat('groove',{color:0x2b2c30}));
    put(new THREE.Mesh(new THREE.CylinderGeometry(.012,.016,.32,12), METAL()), 869, 162, 1.06);   // Ideal Standard Ceralook
    bx(865,160,873,182,.022,1.21,METAL());
    counterLed = bx(668,196,958,199,.01,1.42,new THREE.MeshBasicMaterial({color:0x9a8f80}));   // LED pod szafkami górnymi
    toSide('north', counterLed);
    bx(665,155,960,158,.15,.9,BRICK(295*S,.15));                               // płytki nad blatem (do 1,05)
    toSide('north', bx(665,155,960,158,.4,1.05,BRICK(295*S,.4)));
    for(const [x1,x2] of [[665,725],[725,796],[796,850],[850,921],[921,960]]){   // szafki górne Szary Taupe
      toSide('north', bx(x1+1,155,x2-1,197,.72,1.45,TAUPE));
      const knob = put(new THREE.Mesh(new THREE.SphereGeometry(.014,10,8), METAL()), x2-8, 198, 1.5); toSide('north', knob);   // gałka HVYT Loft
    }
    toSide('north', bx(726,158,795,197,.035,1.41,mat('hood',{color:0xc4c7cc, roughness:.3, metalness:.7})));   // okap Bosch srebrny
    for(const [y1,y2] of [[228,284],[284,342]]) bx(962,y1+1,1028,y2-1,.78,.08,WALNUT());
    rail(959.5,256,.78,true); rail(959.5,313,.78,true);
    bx(960,226,1030,343,.038,.862,GRANITE);
    bx(1027,228,1030,342,.15,.9,BRICK(114*S,.15)); toSide('east', bx(1027,228,1030,342,.4,1.05,BRICK(114*S,.4)));
    for(const [y1,y2] of [[228,285],[285,342]]){ toSide('east', bx(988,y1+1,1030,y2-1,.72,1.45,TAUPE));
      toSide('east', put(new THREE.Mesh(new THREE.SphereGeometry(.014,10,8), METAL()), 986, y2-8, 1.5)) }
    bx(962,343,1028,415,.97,.08,WALNUT());                                    // zabudowa lodówki Bosch KIN86NSE0
    toSide('east', bx(962,343,1028,415,1.12,1.05,WALNUT()));
    rail(959.5,380,.6,true); rail(959.5,380,1.3,true);

    /* ── ŁAZIENKA: wanna z parawanem, podwieszane WC, szafka z umywalką ── */
    const VENICE = (len, h) => tiled('venice', veniceTex, .6, 1.2, len, h, {roughness:.55});
    // płytki Venice Ivory na ścianach łazienki (od środka)
    bx(685,660,1030,663,.62,0,VENICE(345*S,.62)); bx(685,660,688,840,.62,0,VENICE(180*S,.62));
    bx(685,837,1030,840,1.05,0,VENICE(345*S,1.05)); toSide('south', bx(685,837,1030,840,1.4,1.05,VENICE(345*S,1.4)));
    bx(1027,660,1030,840,1.05,0,VENICE(180*S,1.05)); toSide('east', bx(1027,660,1030,840,1.4,1.05,VENICE(180*S,1.4)));
    // w środku łazienki: płytki także powyżej ścian działowych
    const upT = (...a) => { const m = bx(...a); scene.remove(m); innerUp.add(m) };
    upT(688,660,795,663,TALL_H-.62,.62,VENICE(107*S,1.83)); upT(890,660,1027,663,TALL_H-.62,.62,VENICE(137*S,1.83));
    upT(685,663,688,837,TALL_H-.62,.62,VENICE(174*S,1.83));
    bx(686,661,769,838,.55,0,mat('tub',{color:0xfbfbfb, roughness:.15}));     // wanna Roca Linea 150×70
    bx(694,670,761,830,.02,.54,mat('tubin',{color:0xe4ebf0, roughness:.1}));
    bx(768,662,771,800,1.4,.56,GLASS()); bx(768,662,771,800,.015,1.96,METAL()); // parawan Roca Capital 115×140 chrom
    put(new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.12,10), METAL()), 728, 836, .7);   // bateria Roca Targa
    bx(886,826,992,840,1.12,0,VENICE(106*S,1.12));   // stelaż TECE 112 cm w zabudowie
    bx(926,823,950,826,.1,.92,mat('flush',{color:0xe9ebee, roughness:.12, metalness:.9}));      // przycisk TECE Now chrom
    rb(898,772,932,826,.17,.27,.06,W()); rb(899,770,931,822,.03,.44,.015,W()); // Roca Rimless Compacto, deska wolnoopadająca
    bx(778,802,858,838,.3,.48,WALNUT());                                       // szafka podumywalkowa na wymiar
    bx(808,800,828,803,.012,.6,METAL());
    rb(788,788,848,838,.13,.78,.03,W());                                       // umywalka Roca Debba 50×42
    bx(796,794,840,830,.01,.905,mat('basin',{color:0xe9eef2, roughness:.1}));
    put(new THREE.Mesh(new THREE.CylinderGeometry(.01,.013,.18,10), METAL()), 818, 834, .99);   // bateria Roca Targa
    const mirror = new THREE.Mesh(new THREE.CircleGeometry(.25,40), mat('mirror',{color:0xc9d6e2, roughness:.08, metalness:0, emissive:0x8a9aaa, emissiveIntensity:.35}));
    mirror.scale.set(1,2,1); mirror.rotation.y = Math.PI; put(mirror, 818, 836, 1.55); toSide('south', mirror);   // lustro owalne 50×100
    toSide('south', put(new THREE.Mesh(new THREE.CylinderGeometry(.02,.02,.16,12), METAL()), 818, 834, 2.12));     // kinkiet Cezanne chrom
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
    bx(550,645,665,835,.95,0,mat('wardrobe',{color:0xefebe5, roughness:.6}));   // szafa
    bx(546,700,549,780,.015,.6,METAL());

    const CURTAIN = mat('curtain',{color:0xd9ccb6, roughness:1, side:THREE.DoubleSide});
    for(const [y1,y2] of [[592,612],[752,772]]){ bx(127,y1,133,y2,.95,.1,CURTAIN); toSide('west', bx(127,y1,133,y2,1.3,1.05,CURTAIN)) }
    toSide('west', bx(128,612,131,752,1.25,1.05,mat('sheer',{color:0xffffff, roughness:1, transparent:true, opacity:.45})));

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
    hotsEl = document.createElement('div'); hotsEl.className = 'h3-labels h3-hots'; el.appendChild(hotsEl);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, .1, 100);

    hemi = new THREE.HemisphereLight(0xffffff, 0xb9c3d6, .42); scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, .5);
    sun.position.set(-6, 10, 4); sun.castShadow = true;
    sun.shadow.mapSize.set(1024,1024); Object.assign(sun.shadow.camera, {left:-7,right:7,top:7,bottom:-7});
    scene.add(sun);

    // podstawa pod mieszkaniem
    box(60,108,1075,908,.08,'#cfd6e3',-.08);
    for(const [k,r] of Object.entries(ROOMS)){
      floors[k] = r.rects.map(([a,b,c,d]) => {
        const base = k === 'lazienka' ? munichTex() : k === 'przedpokoj' ? acronTex() : oakTex(), t = base.clone(); t.needsUpdate = true;
        if(k === 'lazienka' || k === 'przedpokoj') t.repeat.set((c-a)*S/.6, (d-b)*S/1.2);       // płytki 60×120
        else t.repeat.set((c-a)*S/2.584, (d-b)*S/1.544);                                       // 2 deski × 8 rzędów
        const m = box(a,b,c,d,.02,'#ffffff',0,{map:t, roughness:k==='lazienka'||k==='przedpokoj'?.45:.75});
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
    for(const [name, sd] of Object.entries(SIDES)){
      side[name] = new THREE.Group(); scene.add(side[name]);
      for(const w of sd.walls){ box(...w, WALL_H, WALL_C); toSide(name, box(...w, TALL_H-WALL_H, WALL_C, WALL_H)) }
    }
    for(const w of INNER) box(...w, INNER_H, WALL_C);
    innerUp = new THREE.Group(); innerUp.visible = false; scene.add(innerUp);
    const upW = (...a) => { const m = box(...a); scene.remove(m); innerUp.add(m); return m };
    for(const w of INNER) upW(...w, TALL_H-INNER_H, WALL_C, INNER_H);
    upW(710,527,720,545, TALL_H, WALL_C);                         // ościeżnica sypialni
    upW(710,545,720,640, TALL_H-2.05, WALL_C, 2.05);              // nadproże drzwi do sypialni
    upW(795,645,890,660, TALL_H-2.05, WALL_C, 2.05);              // nadproże drzwi do łazienki
    ceilingG = new THREE.Group(); ceilingG.visible = false; scene.add(ceilingG);
    const ceil = box(80,128,1055,888,.04,'#fafafa',TALL_H); ceil.castShadow = false; scene.remove(ceil); ceilingG.add(ceil);
    const glass = {transparent:true, opacity:.3, roughness:.05, color:'#a9c6ee'};
    // O12 drzwi balkonowe (od podłogi), O3 okno (parapet 85 cm)
    for(const [w, sill] of [[WINDOWS[0], 0], [WINDOWS[1], .85]]){
      if(sill) box(...w, sill, WALL_C);
      const lo = box(w[0]+14,w[1],w[2]-14,w[3], WALL_H-sill, '#a9c6ee', sill, glass); lo.castShadow = false;
      const hi = box(w[0]+14,w[1],w[2]-14,w[3], 2.25-WALL_H, '#a9c6ee', WALL_H, glass); hi.castShadow = false; toSide('west', hi);
      toSide('west', box(...w, TALL_H-2.25, WALL_C, 2.25));
    }
    // drzwi wejściowe
    box(1036,522,1044,633,WALL_H,'#8f8b85'); toSide('east', box(1036,522,1044,633,2.05-WALL_H,'#8f8b85',WALL_H));
    toSide('east', box(1030,520,1055,635,TALL_H-2.05,WALL_C,2.05));
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
      if(mode === 'inside'){
        if(pts.size === 1){ yaw += dx*.005; pitch = Math.min(.6, Math.max(-.75, pitch + dy*.004)); moved += Math.abs(dx)+Math.abs(dy) }
        else if(pts.size === 2){ const [a,b] = [...pts.values()]; const d = Math.hypot(a.x-b.x, a.y-b.y);
          if(lastPinch) fov = Math.min(80, Math.max(32, fov * lastPinch / d)); lastPinch = d; moved = 99 }
        tween = null;
      }
      else if(pts.size === 1){ az -= dx*.008; pol = Math.min(1.25, Math.max(.45, pol - dy*.006)); moved += Math.abs(dx)+Math.abs(dy); if(moved > 6) goal = null }
      else if(pts.size === 2){
        const [a,b] = [...pts.values()]; const d = Math.hypot(a.x-b.x, a.y-b.y);
        if(lastPinch) dist = Math.min(30, Math.max(5, dist * lastPinch / d)); lastPinch = d; moved = 99; goal = null;
      }
      kick();
    });
    const up = e => {
      if(pts.size === 1 && moved < 6 && mode === 'outside') pick(e, onRoom);
      pts.delete(e.pointerId); if(pts.size < 2) lastPinch = 0;
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => { e.preventDefault();
      if(mode === 'inside') fov = Math.min(80, Math.max(32, fov * (1 + e.deltaY*.001)));
      else dist = Math.min(30, Math.max(5, dist * (1 + e.deltaY*.001)));
      kick() }, {passive:false});
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
  const animating = () => anim.washer || anim.coffee || anim.tv || (vac && vac.mode !== 'idle') || !!goal || !!tween;
  const dirVec = () => new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch), Math.sin(pitch), Math.cos(yaw)*Math.cos(pitch));
  const orbitPos = () => new THREE.Vector3(target.x + dist*Math.sin(pol)*Math.sin(az), target.y + dist*Math.cos(pol), target.z + dist*Math.sin(pol)*Math.cos(az));
  function setInterior(on){
    ceilingG.visible = on; innerUp.visible = on;
    if(on) for(const g of Object.values(side)) g.visible = true;
    labelsEl.style.display = on ? 'none' : ''; hotsEl.style.display = on ? '' : 'none';
    for(const [k,b] of Object.entries(bulbs)){                 // żarówki → plafony pod sufitem
      b.position.y = on ? TALL_H - .03 : 1.15; b.scale.set(on?2.4:1, on?.2:1, on?2.4:1);
      lights[k].position.y = on ? TALL_H - .25 : .95;
    }
    hemi.intensity = on ? .55 : .42;
    needs = true;
  }
  function startTween(toPos, toLook, toFov, done){
    tween = {t0:performance.now(), dur:900, fromPos:camera.position.clone(), fromLook:lookPt.clone(), fromFov:camera.fov, toPos, toLook, toFov, done};
    kick();
  }
  function stepTween(){
    const k = Math.min(1, (performance.now()-tween.t0)/tween.dur), e = k<.5 ? 4*k*k*k : 1-Math.pow(-2*k+2,3)/2;
    camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
    lookPt.lerpVectors(tween.fromLook, tween.toLook, e);
    camera.fov = tween.fromFov + (tween.toFov - tween.fromFov)*e; camera.updateProjectionMatrix();
    camera.lookAt(lookPt);
    if(k >= 1){ const d = tween.done; tween = null; d && d() }
  }
  function enter(room, devs, onTap){
    const v = VIEWS[room]; if(!v) return false;
    if(mode === 'outside') saved = {az, pol, dist, target:target.clone()};
    goal = null; mode = 'inside'; insideRoom = room; onTapDev = onTap;
    const [x,z] = P(...v.at); eye.set(x, EYE_H, z); yaw = v.yaw; pitch = -.08; fov = v.fov;
    setInterior(true);
    hotsEl.innerHTML = '';
    devs.forEach((d, i) => {
      const b = document.createElement('button');
      b.className = 'h3-hot'; b.dataset.id = d.id; b.innerHTML = d.html;
      let a = ANCHORS[d.id];
      if(!a && d.id !== 'dev-odkurzacz'){ const [lx,ly] = ROOMS[room].light; a = d.type === 'light' ? [lx + i*25, ly, 2.25] : [lx + (i-1)*45, ly + 30, 1] }
      b._anchor = a ? new THREE.Vector3(...P(a[0],a[1]).flatMap((c,j)=>j===0?[c,a[2]]:[c])) : null;
      b._robot = d.id === 'dev-odkurzacz';
      b.addEventListener('pointerdown', e => e.stopPropagation());
      b.onclick = e => { e.stopPropagation(); onTapDev && onTapDev(d.id) };
      hotsEl.appendChild(b);
    });
    startTween(eye.clone(), eye.clone().add(dirVec()), fov);
    return true;
  }
  function exit(){
    if(mode !== 'inside') return;
    mode = 'outside'; insideRoom = null; hotsEl.innerHTML = '';
    setInterior(false);
    if(saved){ az = saved.az; pol = saved.pol; dist = saved.dist; target.copy(saved.target) }
    updateCutaway();
    startTween(orbitPos(), target.clone(), 30);
  }
  function placeHots(){
    const W = el.clientWidth, H = el.clientHeight;
    for(const b of hotsEl.children){
      const p = b._robot ? robot.position.clone().setY(.35) : b._anchor; if(!p){ b.style.visibility = 'hidden'; continue }
      const v = p.clone().project(camera), vis = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      b.style.visibility = vis ? '' : 'hidden';
      if(vis) b.style.transform = `translate(${(v.x+1)/2*W}px, ${(1-v.y)/2*H}px) translate(-50%,-50%)`;
    }
  }
  function focus(room){
    if(room === focused) return; focused = room;
    const R = room && ROOMS[room];
    let tx = 0, tz = .25, d = DIST_ALL, p = .86;
    if(R){ const xs = R.rects.flatMap(r=>[r[0],r[2]]), ys = R.rects.flatMap(r=>[r[1],r[3]]);
      [tx,tz] = P((Math.min(...xs)+Math.max(...xs))/2, (Math.min(...ys)+Math.max(...ys))/2);
      const span = Math.max(Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys))*S;
      d = Math.max(6.5, Math.min(DIST_ROOM + 2, span*1.6 + 3.2)); p = .5 }   // pokój: widok bardziej z góry, żeby ściany nie zasłaniały
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
  function updateCutaway(){
    const cx = Math.sin(az), cz = Math.cos(az);
    for(const [name, sd] of Object.entries(SIDES)) side[name].visible = (cx*sd.n[0] + cz*sd.n[1]) < .25;
  }
  function loop(){
    raf = 0;
    const moving = needs, a = animating();
    if(!moving && !a) return;
    needs = false;
    if(a) step(); else clock.getDelta();
    if(tween) stepTween();
    else if(mode === 'inside'){
      camera.position.copy(eye); lookPt.copy(eye).add(dirVec()); camera.lookAt(lookPt);
      if(camera.fov !== fov){ camera.fov = fov; camera.updateProjectionMatrix() }
    } else {
      camera.position.copy(orbitPos()); lookPt.copy(target); camera.lookAt(target);
      if(camera.fov !== 30){ camera.fov = 30; camera.updateProjectionMatrix() }
      if(moving) updateCutaway();
    }
    renderer.render(scene, camera);
    if(mode === 'inside' || tween) placeHots();
    if(mode === 'outside' && (moving || tween)) placeLabels();
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
      L.intensity = lvl * (mode === 'inside' ? 1.5 : 4.2);
      bulbs[k].material.color.set(st.on ? 0xffd38f : 0xd9d9d9);
      for(const f of floors[k]){
        if(mode === 'inside') f.material.emissive.set(0x000000);
        else if(k === state.selected){ f.material.emissive.set(0x2a55c9); f.material.emissiveIntensity = .22 }
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
    if(mode === 'outside') focus(state.selected || null);
    for(const b of hotsEl.children) b.classList.toggle('on', !!(state.devOn||{})[b.dataset.id]);
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

  window.Home3D = { build, update, kick, resize, enter, exit, rooms: Object.keys(VIEWS) };
})();
