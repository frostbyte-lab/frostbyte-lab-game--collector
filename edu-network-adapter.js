/*
 * EduNetwork adapter contract for captured game packages.
 * This helper does not emulate or bypass the provider backend. It only exposes
 * the official EduGameClient contract to a hosted package.
 */
(function (global) {
  "use strict";
  function base() {
    return String(global.__EDU_ORIGIN__ || global.location?.origin || "").replace(/\/$/, "");
  }
  function gameId() { return global.__EDU_GAME_ID__ || "game-N"; }
  function client() {
    if (typeof global.EduGameClient !== "function") throw new Error("EduGameClient belum dimuat");
    return global.edu || (global.edu = new global.EduGameClient({ baseUrl: base(), gameId: gameId() }));
  }
  global.EduNetworkAdapter = {
    config: function () { return client().loadConfig(); },
    init: function (initialBalance) { return client().init(initialBalance == null ? 0 : initialBalance); },
    session: function () { return client().openSession(); },
    balance: function () { return client().balance(); },
    bet: function (amount) { return client().bet(amount); },
    spin: function (bet) { return client().spin(bet); },
    result: function (spinId) { return client().result(spinId); },
    history: function (limit) { return client().history(limit); },
    collect: function () { return client().collect(); },
    bonus: function (type, amount) { return client().bonus(type, amount); }
  };
})(typeof window !== "undefined" ? window : globalThis);
