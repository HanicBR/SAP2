const map = 'gm_genesis';
const url = `https://steamcommunity.com/workshop/browse/?appid=4000&searchtext=${encodeURIComponent(map)}&actualsort=textsearch&p=1&numperpage=30`;
(async () => {
  const res = await fetch(url, { headers: { 'User-Agent': 'backstabber-workshop-auto/1.0' } });
  const html = await res.text();
  const regex = /data-publishedfileid="(\d+)"[\s\S]{0,1800}?<div class="workshopItemTitle ellipsis">([\s\S]*?)<\/div>/gi;
  let m = null;
  const out = [];
  while ((m = regex.exec(html)) !== null) {
    out.push({ id: m[1], title: String(m[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
  }
  console.log('matches', out.length);
  console.log(out.slice(0, 10));
})();
