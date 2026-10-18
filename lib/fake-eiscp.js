'use strict';
// Récepteur Pioneer récent simulé (protocole eISCP, type VSX-LX303) : démo et tests du pont lib/eiscp.js.
// stream() renvoie une fonction qui reçoit les octets envoyés (chaîne latin1) et rend les octets de réponse.
const { frame, createDeframer, toLatin1 } = require('./eiscp');

const NRI = `<?xml version="1.0" encoding="utf-8"?><response status="ok"><device id="VSX-LX303">
<brand>Pioneer</brand><category>AV Receiver</category><year>2018</year><model>VSX-LX303</model><destination>xx</destination>
<friendlyname>Salon LX303</friendlyname><firmwareversion>1050-6000-3070-0010</firmwareversion>
<zonelist><zone id="1" value="1" name="Main" volmax="82" volstep="0"/><zone id="2" value="1" name="Zone2" volmax="82" volstep="0"/><zone id="3" value="0" name="Zone3" volmax="0" volstep="0"/></zonelist>
<selectorlist count="11"><selector id="10" value="1" name="BD/DVD" zone="03" iconid="10"/><selector id="01" value="1" name="CBL/SAT" zone="03" iconid="01"/>
<selector id="02" value="1" name="GAME" zone="03" iconid="02"/><selector id="11" value="1" name="STRM BOX" zone="03" iconid="11"/>
<selector id="12" value="1" name="TV" zone="01" iconid="12"/><selector id="23" value="1" name="CD" zone="03" iconid="23"/>
<selector id="24" value="1" name="FM" zone="03" iconid="24"/><selector id="25" value="1" name="AM" zone="03" iconid="25"/>
<selector id="29" value="1" name="USB" zone="03" iconid="29"/><selector id="2B" value="1" name="NET" zone="03" iconid="2B"/>
<selector id="2E" value="1" name="BLUETOOTH" zone="03" iconid="2E"/><selector id="55" value="1" name="HDMI 5" zone="01" iconid="55"/></selectorlist>
<presetlist count="40"><preset id="01" band="1" freq="8750" name="France Inter"/><preset id="02" band="1" freq="10550" name="FIP"/><preset id="03" band="1" freq="9010" name="Nostalgie"/><preset id="04" band="0" freq="0" name=""/></presetlist>
<tuners><tuner band="FM" min="87500" max="108000" step="50"/><tuner band="AM" min="522" max="1611" step="9"/></tuners>
</device></response>`;

const PIONEER_LMD = ['00', '01', '03', '05', '06', '08', '09', '0A', '0B', '0C', '0D', '0E', '0F', '11', '13', '40', '80', '82', 'FF'];
const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function createEiscpDevice() {
  const s = { PWR: '01', AMT: '00', MVL: 0x6A, SLI: '10', LMD: '80', B: 0, T: 0, TUN: 8750, PRS: 1, ZPW: '00', ZVL: 0x50, ZMT: '00', SLZ: '23', NTI: 'Demo Track', play: 'S' };
  const tone = (d) => (d === 0 ? '00' : `${d > 0 ? '+' : '-'}${Math.abs(d).toString(16).toUpperCase()}`);
  const status = {
    PWR: () => s.PWR, AMT: () => s.AMT, MVL: () => hex2(s.MVL), SLI: () => s.SLI, LMD: () => s.LMD, TFR: () => `B${tone(s.B)}T${tone(s.T)}`,
    TUN: () => String(s.TUN).padStart(5, '0'), PRS: () => hex2(s.PRS), ZPW: () => s.ZPW, ZVL: () => hex2(s.ZVL), ZMT: () => s.ZMT, SLZ: () => s.SLZ,
    NTI: () => toLatin1(s.NTI), NRI: () => toLatin1(NRI),
  };
  // Une commande eISCP (sans "!1") → liste de réponses (sans "!1")
  function handle(body) {
    const code = body.slice(0, 3), v = body.slice(3);
    const reply = (c) => [`${c}${status[c]()}`];
    if (v === 'QSTN') return status[code] ? reply(code) : [`${code}N/A`];
    switch (code) {
      case 'PWR': case 'AMT': case 'ZPW': case 'ZMT': if (/^0[01]$/.test(v)) { s[code] = v; return reply(code); } break;
      case 'MVL': case 'ZVL': {
        const max = 0xA4;
        if (v === 'UP' || v === 'DOWN') s[code] = clamp(s[code] + (v === 'UP' ? 1 : -1), 0, max);
        else if (/^[0-9A-F]{2}$/.test(v)) s[code] = clamp(parseInt(v, 16), 0, max); else break;
        return reply(code);
      }
      case 'SLI': case 'SLZ': if (/^[0-9A-F]{2}$/.test(v)) { s[code] = v; const out = reply(code); if (code === 'SLI' && ['24', '25', '26'].includes(v)) { if (v === '25') s.TUN = 531; if (v === '24') s.TUN = 8750; out.push(...reply('TUN')); } return out; } break;
      case 'LMD': if (PIONEER_LMD.includes(v)) { s.LMD = v; return reply('LMD'); } break;
      case 'TFR': {
        let m;
        if ((m = /^([BT])([+-][0-9A-F]|00)$/.exec(v))) s[m[1]] = clamp(m[2] === '00' ? 0 : parseInt(m[2].slice(1), 16) * (m[2][0] === '-' ? -1 : 1), -10, 10);
        else if ((m = /^([BT])(UP|DOWN)$/.exec(v))) s[m[1]] = clamp(s[m[1]] + (m[2] === 'UP' ? 1 : -1), -10, 10);
        else break;
        return reply('TFR');
      }
      case 'TUN':
        if (v === 'UP' || v === 'DOWN') { s.TUN += (s.TUN >= 2000 ? 5 : 9) * (v === 'UP' ? 1 : -1); return reply('TUN'); }
        if (v === 'DIRECT') { s.digits = ''; return []; }
        if (/^\d$/.test(v) && s.digits !== undefined) { s.digits += v; if (s.digits.length >= 4 && s.TUN >= 2000) { s.TUN = +s.digits; s.digits = undefined; return reply('TUN'); } return []; }
        break;
      case 'PRS':
        if (v === 'UP' || v === 'DOWN') s.PRS = clamp(s.PRS + (v === 'UP' ? 1 : -1), 1, 40);
        else if (/^[0-9A-F]{2}$/.test(v)) s.PRS = clamp(parseInt(v, 16), 1, 40); else break;
        return reply('PRS');
      case 'NTC': if (['PLAY', 'PAUSE', 'STOP', 'TRUP', 'TRDN', 'REPEAT', 'RANDOM'].includes(v)) { if (v === 'TRUP') s.NTI = 'Next Track'; if (v === 'TRDN') s.NTI = 'Previous Track'; return reply('NTI'); } break;
      case 'OSD': if (['UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER', 'EXIT', 'HOME', 'MENU'].includes(v)) return []; break;
      default: break;
    }
    return [`${code}N/A`];
  }
  function stream() {
    const deframe = createDeframer();
    // L'ampli termine ses messages par EOF CR LF
    return (chunk) => deframe(chunk).flatMap(handle).map((b) => frame(`!1${b}\x1a\r\n`)).join('');
  }
  return { state: s, model: 'VSX-LX303', eiscp: true, handle, stream };
}

module.exports = { createEiscpDevice, NRI };
