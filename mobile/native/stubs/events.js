'use strict';
// EventEmitter minimal pour la WebView (le code partagé utilise on / once / off / emit).
class EventEmitter {
  constructor() { this._h = {}; }
  on(ev, fn) { (this._h[ev] ||= []).push(fn); return this; }
  once(ev, fn) { const w = (...a) => { this.off(ev, w); fn(...a); }; return this.on(ev, w); }
  off(ev, fn) { this._h[ev] = (this._h[ev] || []).filter((f) => f !== fn); return this; }
  removeListener(ev, fn) { return this.off(ev, fn); }
  removeAllListeners(ev) { if (ev) delete this._h[ev]; else this._h = {}; return this; }
  emit(ev, ...args) { for (const fn of [...(this._h[ev] || [])]) fn(...args); return (this._h[ev] || []).length > 0; }
}
module.exports = { EventEmitter };
