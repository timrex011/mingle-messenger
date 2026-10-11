'use strict';

async function getIpLocation(ip) {
  const cleanIp = (ip || '').replace(/^::ffff:/, '').trim();

  // Handle local / private / loopback IP addresses
  if (
    !cleanIp ||
    cleanIp === '127.0.0.1' ||
    cleanIp === '::1' ||
    cleanIp.startsWith('10.') ||
    cleanIp.startsWith('192.168.') ||
    cleanIp.startsWith('172.16.') ||
    cleanIp === 'localhost'
  ) {
    return {
      ip: cleanIp || '127.0.0.1',
      city: 'Lokales Netzwerk / Testumgebung',
      country: 'Lokal'
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(cleanIp)}?fields=status,country,city,regionName`, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'success') {
        const city = data.city || data.regionName || 'Unbekannte Stadt';
        const country = data.country || '';
        return {
          ip: cleanIp,
          city: country ? `${city}, ${country}` : city,
          country
        };
      }
    }
  } catch (err) {
    console.warn('[Geolocation] Standort-Abfrage fehlgeschlagen:', err.message);
  }

  return {
    ip: cleanIp,
    city: 'Standort unbekannt',
    country: ''
  };
}

module.exports = {
  getIpLocation
};
