import { URLFilter, FilterRule } from '../src/pipeline/filter';

const rules: FilterRule[] = [
  { type: 'extension', value: '.xhtml', isInclude: true }, // Must be .xhtml
  { type: 'contains', value: 'secret', isInclude: false }   // Must NOT contain 'secret'
];

const filter = new URLFilter(rules);

const testUrls = [
  "http://example.com/page001.xhtml",         // Should pass
  "http://example.com/secret-page002.xhtml",  // Should fail (contains 'secret')
  "http://example.com/page003.html"           // Should fail (wrong extension)
];

console.log("Testing URL Filters:");
testUrls.forEach(url => {
  console.log(`- ${url} -> Allowed? ${filter.isAllowed(url)}`);
});
