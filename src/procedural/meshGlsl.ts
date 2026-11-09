/* The CSS-compatible mesh sampler.
 *
 * It reproduces, in one fragment-shader pass, what the browser does with a mesh layer's CSS (see mesh.ts / css.ts):
 *
 *   background  The `background-image` list of meshParts(): one `radial-gradient(ellipse rx ry at x y, c·a 0%, [mid%], c·0 100%)`
 *               per point, FIRST point on top, over the mesh base colour. The optional middle value is a CSS colour HINT
 *               (mid = 25 + core / 2 %). For two stops of the same colour the premultiplied interpolation keeps the colour and
 *               moves only alpha, so   a(t) = a0 · (1 − t^k)   with   k = ln 0.5 / ln(mid)   (k = 1 when no hint is written).
 *               Points are composited source-over, bottom (last point) to top (first point), in premultiplied alpha.
 *   layered     The studio preview (layerCss): one box per point (2·size wide, square in pixels), centred on the point,
 *               `mix-blend-mode: screen`, gradient `ellipse at center` = farthest-corner = size·√2, which is a straight
 *               a(t) = a0 · (1 − t) ramp (the explicit fade stop lies on that line) cut off by the box.
 *
 * Records arrive bottom → top (the runtime reverses the mesh order), so the loop is a plain "paint over the accumulator".
 * Radii are in canvas-height units (size % of the canvas WIDTH × aspect), i.e. a circle in pixels, exactly like pointRadii().
 * Everything is evaluated in gamma-encoded sRGB with straight-alpha output, because that is the space CSS composites in.
 *
 *   uProcPoints[i] = (x, y, radius, alpha)          uProcColors[i] = (r, g, b, hint exponent k)
 *   uProcBase      = (r, g, b, base alpha)           uProcE         = (css on, layered, ellipse ratio ry/rx, 0)            */
/** The shared GL context blends SRC_ALPHA / ONE_MINUS_SRC_ALPHA into a straight-alpha canvas, so a translucent pixel (c, a) would be
 *  stored as (c·a, a²) and look too dark. While that blend is active the mesh pre-compensates: it writes (c / √a, √a), which the
 *  blend turns back into (c, a) exactly wherever c ≤ √a. If the renderer draws this program with blending off (see NOTES), set
 *  this to false: the shader then writes the straight (c, a) itself. */
export const PREMULT_BLEND_COMPENSATION = true;

export function cssMeshGlsl(capacity: number): string {
  return `vec4 procSampleCss(vec2 uv) {
  float count = uProcA.y;
  vec2 asp = vec2(uAspect, 1.0);
  float layered = uProcE.y;
  float ratio = max(uProcE.z, 0.0001);
  vec3 acc = uProcBase.rgb * uProcBase.a;
  float accA = uProcBase.a;
  for (int i = 0; i < ${capacity}; i++) {
    if (float(i) >= count) break;
    vec4 pt = uProcPoints[i];
    vec4 col = uProcColors[i];
    vec2 d = (uv - pt.xy) * asp;
    d.y /= ratio;
    float radius = max(pt.z, 0.0001);
    if (layered > 0.5) {
      float inside = step(abs(d.x), radius) * step(abs(d.y), radius);
      float s = pt.w * max(1.0 - length(d) / (radius * 1.41421356), 0.0) * inside;
      vec3 backdrop = accA > 0.00001 ? acc / accA : vec3(0.0);
      vec3 screened = backdrop + col.rgb - backdrop * col.rgb;
      acc = s * (1.0 - accA) * col.rgb + s * accA * screened + (1.0 - s) * acc;
      accA = s + accA * (1.0 - s);
    } else {
      float t = length(d) / radius;
      float s = t < 1.0 ? pt.w * (1.0 - pow(max(t, 0.000001), col.w)) : 0.0;
      acc = col.rgb * s + acc * (1.0 - s);
      accA = s + accA * (1.0 - s);
    }
  }
  return vec4(accA > 0.00001 ? acc / accA : vec3(0.0), accA);
}`;
}
