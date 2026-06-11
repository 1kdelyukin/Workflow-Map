// The browser modules under js/ are pure logic but ui.js installs a window keydown
// listener at import time. Import this module FIRST (static imports evaluate in
// declaration order) so they load cleanly in Node.
globalThis.window ??= { addEventListener() {} };
