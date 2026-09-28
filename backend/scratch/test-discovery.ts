import { DiscoveryEngine } from '../src/pipeline/discovery';

const engine = new DiscoveryEngine();

console.log("Testing Pattern Generator:");
const testPattern = "http://example.com/books/9781108964227/page{001-005}.xhtml";

engine.discover({ mode: 'pattern', startUrl: testPattern }, (url) => {
  console.log("Discovered:", url);
});
