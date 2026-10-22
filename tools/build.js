// Inlines the engine into single-file pages so they work offline with no server:
//   designer/index.src.html (+ app/ extensions) -> halfblip.html   all-in-one: dock, Studio, Respond, Listen
//   designer/index.src.html                     -> index.html      designer only (lighter)
//   demo/listen.src.html                        -> demo/listen.html listening demo only (lighter)
const fs = require('fs'), path = require('path'), root = path.join(__dirname, '..'), rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const eng = rd('engine/blip-engine.js'), lis = rd('engine/blip-listen.js').replace("factory(require('./blip-engine.js'))", "factory(root.Blip)");
function build(src, out, subs) {
  let t = rd(src); for (const [k, v] of Object.entries(subs)) { if (!t.includes(k)) throw new Error(k + ' missing in ' + src); t = t.replace(k, () => v); }
  fs.writeFileSync(path.join(root, out), t); console.log('built', out, (t.length / 1024).toFixed(1) + ' KB');
}
const none = { '/*@EXT-CSS@*/': '', '<!--@EXT-TOP@-->': '', '<!--@EXT-VIEWS@-->': '', '/*@EXT-JS@*/': '' };
build('designer/index.src.html', 'index.html', { '/*@ENGINE@*/': eng, ...none });
build('designer/index.src.html', 'halfblip.html', {
  '/*@ENGINE@*/': eng, '<title>Blip Lab</title>': '<title>Half Blip</title>',
  '/*@EXT-CSS@*/': rd('app/temper-ui.css') + '\n' + rd('app/ext.css'), '<!--@EXT-TOP@-->': rd('app/ext.top.html'), '<!--@EXT-VIEWS@-->': rd('app/ext.views.html'),
  '/*@EXT-JS@*/': lis + '\n' + rd('app/temper-ui.js') + '\n' + rd('app/ext.js'),
});
build('demo/listen.src.html', 'demo/listen.html', { '/*@ENGINE@*/': eng, '/*@LISTEN@*/': lis, '/*@TEMPERUI@*/': rd('app/temper-ui.js'), '/*@TEMPERCSS@*/': rd('app/temper-ui.css'), '/*@CHIRP@*/null': rd('examples/chirp.character.json').trim() });
