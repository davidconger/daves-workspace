// Shared colour classifier.
//
// The first version picked the nearest palette RGB, which failed badly: the
// midpoint of a green-to-white antialiased edge is (165,224,147), nearer to
// mid gray than to either parent, so every green edge grew a false gray halo.
//
// The second version switched to "chroma first" (max-min < 40 means achromatic).
// That killed the halo but put the green/gray boundary in the wrong place. Green
// (76,193,40) blended 50/50 with gray (149,149,151) gives (112,171,95), whose
// max-min is 76 - still comfortably chromatic. So the decision boundary sat far
// over on the gray side, out in the shallow tail of the gradient where JPEG
// noise dominates, and the resulting mask edge was visibly ragged.
//
// This version measures each hue directly and thresholds at the true 50% mix,
// where the gradient is steepest and noise moves the edge least.
//
//   greenness = g - (r+b)/2   pure green 135, gray -1, white 0, red -108
//   redness   = r - (g+b)/2   pure red   205, gray -1, white 0, green -40
//
// Half of 135 and 205 give the thresholds below.

const WHITE = 0, GREEN = 1, GRAY = 2, RED = 3;
const NAMES = ['white', 'green', 'gray', 'red'];
const HEX = { white: '#ffffff', green: '#4cc128', gray: '#959597', red: '#ed1c24' };

const GREENNESS = 67;
const REDNESS = 102;
// Midpoint between the gray value (149) and white (255).
const WHITE_CUT = 202;

function classify(r, g, b) {
  if (g - (r + b) / 2 > GREENNESS) return GREEN;
  if (r - (g + b) / 2 > REDNESS) return RED;
  return Math.max(r, g, b) > WHITE_CUT ? WHITE : GRAY;
}

module.exports = { classify, WHITE, GREEN, GRAY, RED, NAMES, HEX };
