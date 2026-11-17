// Pobiera status przesyłki i zwraca go w jednym formacie:
// { status, statusText, events:[{time, text, location}], eta, pickupPoint, source }
//
// status: pending | transit | out | pickup | delivered | problem | unknown
//
// Źródła:
//  - InPost: publiczne API ShipX (bez klucza)
//  - Poczta Polska: publiczna usługa SOAP (bez klucza)
//  - pozostali przewoźnicy: 17TRACK (wymaga zmiennej środowiskowej TRACK17_KEY na Vercelu)

const INPOST_URL = 'https://api-shipx-pl.easypack24.net/v1';
const T17_URL = 'https://api.17track.net/track/v2.2';

// Najczęstsze statusy InPost (używane, gdy słownik z API jest niedostępny)
const INPOST_TITLES = {
  created: 'Przesyłka utworzona',
  offers_prepared: 'Przygotowano oferty',
  offer_selected: 'Oferta wybrana',
  confirmed: 'Przygotowana przez nadawcę',
  dispatched_by_sender: 'Paczka nadana w paczkomacie',
  dispatched_by_sender_to_pok: 'Nadana w punkcie obsługi',
  collected_from_sender: 'Odebrana od nadawcy',
  taken_by_courier: 'Odebrana przez kuriera',
  taken_by_courier_from_pok: 'Odebrana z punktu przez kuriera',
  adopted_at_source_branch: 'Przyjęta w oddziale',
  sent_from_source_branch: 'W trasie',
  adopted_at_sorting_center: 'Przyjęta w sortowni',
  sent_from_sorting_center: 'Wysłana z sortowni',
  adopted_at_target_branch: 'Przyjęta w oddziale docelowym',
  out_for_delivery: 'Wydana do doręczenia',
  out_for_delivery_to_address: 'Kurier w drodze pod adres',
  ready_to_pickup: 'Gotowa do odbioru w paczkomacie',
  ready_to_pickup_from_pok: 'Gotowa do odbioru w punkcie',
  ready_to_pickup_from_pok_registered: 'Gotowa do odbioru w punkcie',
  ready_to_pickup_from_branch: 'Gotowa do odbioru w oddziale',
  pickup_reminder_sent: 'Przypomnienie o odbiorze',
  pickup_reminder_sent_address: 'Przypomnienie o odbiorze',
  stack_in_box_machine: 'Paczka w paczkomacie tymczasowym',
  stack_in_customer_service_point: 'Paczka w punkcie tymczasowym',
  unstack_from_box_machine: 'Paczka w drodze do docelowego paczkomatu',
  unstack_from_customer_service_point: 'Paczka w drodze do punktu',
  redirect_to_box: 'Przekierowana do paczkomatu',
  readdressed: 'Przekierowana na inny adres',
  delay_in_delivery: 'Opóźnienie w doręczeniu',
  avizo: 'Powrót do oddziału (awizo)',
  delivered: 'Doręczona',
  pickup_time_expired: 'Upłynął termin odbioru',
  stack_parcel_pickup_time_expired: 'Upłynął termin odbioru',
  stack_parcel_in_box_machine_pickup_time_expired: 'Upłynął termin odbioru',
  rejected_by_receiver: 'Odmowa przyjęcia',
  undelivered: 'Nie doręczono',
  undelivered_wrong_address: 'Nie doręczono — błędny adres',
  undelivered_incomplete_address: 'Nie doręczono — niepełny adres',
  undelivered_unknown_receiver: 'Nie doręczono — nieznany odbiorca',
  returned_to_sender: 'Zwrot do nadawcy',
  canceled: 'Anulowana',
  claimed: 'Reklamacja',
  missing: 'Zaginiona',
  oversized: 'Gabaryt — doręczenie kurierem',
  other: 'Inny status',
};

function inpostKind(code) {
  if (!code) return 'unknown';
  if (code === 'delivered') return 'delivered';
  if (code.startsWith('ready_to_pickup') || code.startsWith('pickup_reminder') ||
      code === 'stack_in_box_machine' || code === 'stack_in_customer_service_point') return 'pickup';
  if (code.startsWith('out_for_delivery')) return 'out';
  if (/expired|undelivered|rejected|returned|canceled|claimed|missing|avizo|delay/.test(code)) return 'problem';
  if (['created', 'offers_prepared', 'offer_selected', 'confirmed'].includes(code)) return 'pending';
  return 'transit';
}

let inpostDict = null;
async function inpostTitles() {
  if (inpostDict) return inpostDict;
  try {
    const r = await fetch(`${INPOST_URL}/statuses?lang=pl_PL`);
    if (r.ok) {
      const j = await r.json();
      const d = {};
      for (const it of j.items || []) if (it.name && it.title) d[it.name] = it.title;
      inpostDict = { ...INPOST_TITLES, ...d };
      return inpostDict;
    }
  } catch {}
  return INPOST_TITLES;
}

async function trackInpost(number) {
  const r = await fetch(`${INPOST_URL}/tracking/${encodeURIComponent(number)}`);
  if (r.status === 404) return { status: 'unknown', statusText: 'Brak danych w InPost', events: [], source: 'inpost' };
  if (!r.ok) throw new Error(`InPost HTTP ${r.status}`);
  const j = await r.json();
  const titles = await inpostTitles();
  const events = (j.tracking_details || []).map((e) => ({
    time: e.datetime,
    text: titles[e.status] || e.status,
    location: '',
  }));
  events.sort((a, b) => new Date(b.time) - new Date(a.time));
  const machine = j.custom_attributes && j.custom_attributes.target_machine_detail;
  let pickupPoint = null;
  if (machine) {
    const a = machine.address || {};
    pickupPoint = [machine.name, a.line1, a.line2].filter(Boolean).join(', ');
  }
  return {
    status: inpostKind(j.status),
    statusText: titles[j.status] || j.status || '',
    events,
    eta: null,
    pickupPoint,
    source: 'inpost',
  };
}


// ── Poczta Polska: publiczna usługa śledzenia (SOAP, ogólnodostępne dane logowania) ──
const PP_URL = 'https://tt.poczta-polska.pl/Sledzenie/services/Sledzenie';

function ppKind(name, final) {
  const t = (name || '').toLowerCase();
  if (/doręczon|odebran|wydano odbiorcy|wydanie w placówce|wydano w placówce/.test(t)) return 'delivered';
  if (/awizo|do odbioru|oczekuje na odbiór|czeka na odbiór|gotowa do odbioru|przesyłka w automacie/.test(t)) return 'pickup';
  if (/do doręczenia|w doręczeniu|doręczanie/.test(t)) return 'out';
  if (/zwrot|nieudan|odmow|nie doręczono|zatrzyman|uszkodz/.test(t)) return 'problem';
  if (final) return 'delivered';
  return 'transit';
}

function xmlText(block, tag) {
  const m = block.match(new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)</(?:\\w+:)?${tag}>`));
  return m ? m[1].trim() : '';
}

async function trackPoczta(number) {
  const envelope = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sled="http://sledzenie.pocztapolska.pl">
<soapenv:Header><wsse:Security soapenv:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><wsse:UsernameToken><wsse:Username>sledzeniepp</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">PPSA</wsse:Password></wsse:UsernameToken></wsse:Security></soapenv:Header>
<soapenv:Body><sled:sprawdzPrzesylke><sled:numer>${number.replace(/[^0-9A-Za-z]/g, '')}</sled:numer></sled:sprawdzPrzesylke></soapenv:Body></soapenv:Envelope>`;
  const r = await fetch(PP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
    body: envelope,
  });
  if (!r.ok) throw new Error(`Poczta Polska HTTP ${r.status}`);
  const xml = await r.text();
  const blocks = xml.match(/<(?:\w+:)?zdarzenie>[\s\S]*?<\/(?:\w+:)?zdarzenie>/g) || [];
  const events = blocks.map((b) => {
    const unit = (b.match(/<(?:\w+:)?jednostka>[\s\S]*?<\/(?:\w+:)?jednostka>/) || [''])[0];
    const reason = (b.match(/<(?:\w+:)?przyczyna>[\s\S]*?<\/(?:\w+:)?przyczyna>/) || [''])[0];
    const own = b.replace(unit, '').replace(reason, '');
    const czas = xmlText(own, 'czas');
    const name = xmlText(own, 'nazwa');
    const why = reason ? xmlText(reason, 'nazwa') : '';
    return {
      time: czas ? czas.replace(' ', 'T') + (czas.length === 16 ? ':00' : '') : null,
      text: why ? `${name} (${why})` : name,
      location: unit ? xmlText(unit, 'nazwa') : '',
      final: xmlText(own, 'konczace') === 'true',
    };
  }).filter((e) => e.text);
  events.sort((a, b) => new Date(b.time) - new Date(a.time));
  if (!events.length) {
    return { status: 'unknown', statusText: 'Brak danych w Poczcie Polskiej', events: [], source: 'poczta' };
  }
  const last = events[0];
  return {
    status: ppKind(last.text, last.final),
    statusText: last.text,
    events: events.map(({ final, ...e }) => e),
    eta: null,
    pickupPoint: ppKind(last.text, last.final) === 'pickup' ? last.location : null,
    source: 'poczta',
  };
}

const T17_KIND = {
  NotFound: 'unknown',
  InfoReceived: 'pending',
  InTransit: 'transit',
  OutForDelivery: 'out',
  AvailableForPickup: 'pickup',
  Delivered: 'delivered',
  DeliveryFailure: 'problem',
  Exception: 'problem',
  Expired: 'problem',
};
const T17_TEXT = {
  NotFound: 'Brak informacji od przewoźnika',
  InfoReceived: 'Przewoźnik otrzymał dane',
  InTransit: 'W drodze',
  OutForDelivery: 'Wydana do doręczenia',
  AvailableForPickup: 'Gotowa do odbioru',
  Delivered: 'Doręczona',
  DeliveryFailure: 'Nieudane doręczenie',
  Exception: 'Problem z przesyłką',
  Expired: 'Śledzenie wygasło',
};

async function t17(path, key, body) {
  const r = await fetch(`${T17_URL}/${path}`, {
    method: 'POST',
    headers: { '17token': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`17TRACK HTTP ${r.status}`);
  return r.json();
}

async function track17(number, key) {
  // Rejestracja jest idempotentna — numer już zarejestrowany trafia do "rejected" i to jest OK
  await t17('register', key, [{ number }]);
  const j = await t17('gettrackinfo', key, [{ number }]);
  const acc = j && j.data && j.data.accepted && j.data.accepted[0];
  const info = acc && acc.track_info;
  if (!info) {
    return { status: 'pending', statusText: 'Zarejestrowano — dane pojawią się za kilka minut', events: [], source: '17track' };
  }
  const st = (info.latest_status && info.latest_status.status) || 'NotFound';
  const events = [];
  for (const p of (info.tracking && info.tracking.providers) || []) {
    for (const e of p.events || []) {
      events.push({ time: e.time_iso || e.time_utc, text: e.description || '', location: e.location || '' });
    }
  }
  events.sort((a, b) => new Date(b.time) - new Date(a.time));
  const ed = info.time_metrics && info.time_metrics.estimated_delivery_date;
  return {
    status: T17_KIND[st] || 'unknown',
    statusText: (events[0] && events[0].text) || T17_TEXT[st] || st,
    events,
    eta: (ed && (ed.to || ed.from)) || null,
    pickupPoint: null,
    source: '17track',
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const number = String((req.query && req.query.number) || '').trim().replace(/\s+/g, '');
  const carrier = String((req.query && req.query.carrier) || '').trim();
  if (!number) {
    res.status(400).json({ error: 'Brak numeru przesyłki' });
    return;
  }
  try {
    if (carrier === 'inpost') {
      res.status(200).json(await trackInpost(number));
      return;
    }
    const key = process.env.TRACK17_KEY;
    if (carrier === 'poczta') {
      try {
        const pp = await trackPoczta(number);
        if (pp.events.length || !key) {
          res.status(200).json(pp);
          return;
        }
      } catch (e) {
        if (!key) throw e;
      }
    }
    if (!key) {
      res.status(200).json({ status: null, manual: true, error: 'Automatyczne śledzenie tego przewoźnika wymaga klucza TRACK17_KEY' });
      return;
    }
    res.status(200).json(await track17(number, key));
  } catch (e) {
    res.status(502).json({ error: String(e && e.message ? e.message : e) });
  }
}
