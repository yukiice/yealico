import { describeGalleryDom } from '../src/platform/manhuaguiProbe';

test('counts pagination candidates in a rendered chapter page', () => {
  const html = `
    <div id="mangaBox">
      <img class="mangaFile" src="/img/1.jpg">
      <img class="mangaFile" src="/img/2.jpg">
    </div>
    <select class="manga-page"><option>1</option><option>2</option></select>
    <a href="#p=2">next</a>`;

  const text = describeGalleryDom(html);

  expect(text).toContain('mangaFile=2');
  expect(text).toContain('legacyImg=0');
  expect(text).toContain('mangaBox=1');
  expect(text).toContain('option=2');
  expect(text).toContain('pageLink=1');
});

test('reports zeros instead of throwing on an empty page', () => {
  const text = describeGalleryDom('<html><body></body></html>');

  expect(text).toContain('img=0');
  expect(text).toContain('select=0');
  expect(text).toContain('pageLink=0');
});
