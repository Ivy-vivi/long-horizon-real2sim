'use strict';
const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const number = value => Number(value || 0).toLocaleString('en-US');
let data, collection, scene, imageIndex = 0;
let query = '', filter = 'all';
const selectedScenes = new Map();
const selectedImages = new Map();
const lightbox = $('#lightbox');

function sceneKey() { return collection.id + ':' + scene.id; }
function badge(s) { return `<span class="status-pill ${s.state}"><i class="dot ${s.state}"></i>${escapeHTML(s.status_label)}</span>`; }
function sceneNumber(s) { return String(s.number ?? s.id).padStart(2, '0'); }
function allScenes() { return data.collections.flatMap(c => c.scenes); }
function updateURL(page, push = false) {
  const url = new URL(location.href);
  url.hash = page;
  url.searchParams.set('part', collection.id);
  url.searchParams.set('scene', scene?.id || '');
  history[push ? 'pushState' : 'replaceState'](null, '', url);
}
function showPage() {
  const page = ['gallery', 'progress', 'about'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'gallery';
  document.querySelectorAll('.page-panel').forEach(panel => { panel.hidden = panel.id !== page; });
  document.querySelectorAll('[data-page]').forEach(link => {
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (page === 'progress') renderProgress();
}
function restoreURL() {
  if (!data) return;
  const params = new URLSearchParams(location.search);
  const id = params.get('part');
  chooseCollection(data.collections.some(c => c.id === id) ? id : data.collections[0].id, params.get('scene'), false);
  showPage();
}

function renderOverview() {
  const scenes = allScenes();
  const panels = scenes.reduce((sum, s) => sum + s.images.length, 0);
  const metrics = [
    ['收录场景', scenes.length, '四个结果集合'],
    ['已有图片', scenes.filter(s => s.images.length).length, '可直接浏览对照'],
    ['精选对比图', panels, '保留完整对照关系'],
    ['每场景视角上限', data.view_limit, '覆盖分散观察方向']
  ];
  $('#overview').innerHTML = metrics.map(([title, count, hint]) => `<div class="metric"><span>${title}</span><strong>${number(count)}</strong><small>${hint}</small></div>`).join('');
  $('#overview').hidden = false;
  const time = new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(data.published_at));
  $('#published-at').textContent = `更新于 ${time} · 北京时间`;
}

function chooseCollection(id, preferredScene, writeURL = true) {
  collection = data.collections.find(c => c.id === id) || data.collections[0];
  const chosen = preferredScene || selectedScenes.get(id);
  scene = collection.scenes.find(s => s.id === chosen) || collection.scenes.find(s => s.images.length) || collection.scenes[0];
  query = ''; filter = 'all';
  $('#search').value = '';
  $('#status-filter').value = 'all';
  $('#collection-tabs').innerHTML = data.collections.map(c => `<button role="tab" aria-selected="${c.id === collection.id}" aria-controls="scene-detail" id="tab-${c.id}" data-collection="${c.id}" tabindex="${c.id === collection.id ? 0 : -1}">${escapeHTML(c.name)}<span>${c.scenes.length}</span></button>`).join('');
  if (scene) selectedScenes.set(id, scene.id);
  imageIndex = scene ? Math.min(selectedImages.get(sceneKey()) || 0, Math.max(0, scene.images.length - 1)) : 0;
  renderSceneList(); renderScene();
  if (writeURL) updateURL('gallery', true);
  showPage();
}
function renderSceneList() {
  const matches = collection.scenes.filter(s => {
    const search = [s.id, s.number, s.name, `场景 ${s.number || s.id}`].join(' ').toLowerCase();
    const statusMatches = filter === 'all' || (filter === 'results' ? s.images.length > 0 : s.state === filter);
    return search.includes(query.toLowerCase().trim()) && statusMatches;
  });
  $('#scene-count').textContent = `${matches.length} / ${collection.scenes.length}`;
  $('#scene-list').innerHTML = matches.length ? matches.map(s => `<button class="scene-button" data-scene="${escapeHTML(s.id)}" aria-pressed="${s.id === scene?.id}" title="${escapeHTML(s.id + ' · ' + s.name + ' · ' + s.status_label)}"><span class="scene-num">${escapeHTML(sceneNumber(s))}</span><span class="scene-label"><strong>${escapeHTML(s.name)}</strong><small>${s.images.length ? s.images.length + ' 张对比图' : '暂无图片'}${collection.id === 'zican' ? ' · ' + escapeHTML(s.id.match(/\d{8}_\d{6}$/)?.[0]?.replace('_',' ') || '') : ''}</small></span><i class="dot ${s.state}" aria-label="${escapeHTML(s.status_label)}"></i></button>`).join('') : '<p class="empty-list">没有找到匹配的场景。<br>试试其他名称、编号或状态。</p>';
}
function chooseScene(id) {
  scene = collection.scenes.find(s => s.id === id);
  if (!scene) return;
  selectedScenes.set(collection.id, id);
  imageIndex = Math.min(selectedImages.get(sceneKey()) || 0, Math.max(0, scene.images.length - 1));
  renderSceneList(); renderScene(); updateURL('gallery', true);
}
function renderScene() {
  const detail = $('#scene-detail');
  detail.setAttribute('aria-labelledby', 'tab-' + collection.id);
  if (!scene) { detail.innerHTML = '<div class="empty-scene">此集合暂无场景。</div>'; return; }
  const selectionText = {camera:'按相机位置与朝向分散选取',sequence:'沿原图序列分散选取',paired:'保留 5 组配对视角与整体剖视'}[scene.selection];
  detail.innerHTML = `<div class="detail-heading"><div><p class="eyebrow">${escapeHTML(collection.id === '2k' ? '2K COLLECTION' : collection.id === 'shells' ? 'SPATIAL STRUCTURE' : collection.id === 'zican' ? 'ZICAN ARCHIVE' : 'SCENE RECONSTRUCTION')} / ${escapeHTML(sceneNumber(scene))}</p><h2>${escapeHTML(scene.name)}</h2><div class="detail-meta">${badge(scene)}<span class="divider">/</span><span>${escapeHTML(scene.version)}</span><span class="divider">/</span><span>${scene.images.length} 张精选对比图</span></div></div><span class="detail-index" aria-hidden="true">${escapeHTML(sceneNumber(scene))}</span></div>
    ${scene.images.length ? '<div class="image-stage"><button class="open-image" aria-label="放大当前对比图"><img id="main-image" alt="" fetchpriority="high"></button><span class="zoom-hint">↗ 点击查看大图</span></div><div class="image-caption"><p class="caption-text"><span id="image-label"></span></p><div class="image-controls"><button id="previous-view" aria-label="上一个视角">‹</button><span id="view-counter"></span><button id="next-view" aria-label="下一个视角">›</button></div></div><div class="thumbnail-strip" role="group" aria-label="选择对比视角"></div>' : `<div class="empty-scene"><h3>${escapeHTML(scene.status_label)}</h3><p>此场景在本次发布时尚无可展示的对比图。</p></div>`}
    ${scene.status_label.includes('轮数上限') ? '<p class="status-note">迭代已结束，达到轮数上限；此状态不代表审核通过。</p>' : ''}
    ${scene.versions.length ? `<details class="versions"><summary>归档版本 · ${scene.versions.length} 个轮次</summary><div class="version-chips">${scene.versions.map(v => `<span>${escapeHTML(v.name)}${v.incomplete ? ' · 未完成' : ''}${v.accepted ? ' · 已验收' : ''}</span>`).join('')}</div></details>` : ''}
    <div class="detail-footer"><p><b>${escapeHTML(selectionText || '')}</b><br>原始对照布局完整保留 · 发布时结果</p><a href="#about">关于这些视角 ↗</a></div>`;
  if (scene.images.length) {
    $('.thumbnail-strip').innerHTML = scene.images.map((im, i) => `<button class="thumb" data-index="${i}" aria-label="视角 ${i + 1}：${escapeHTML(im.label)}" aria-pressed="${i === imageIndex}"><img src="${im.thumb}" alt="" loading="lazy" width="${im.width}" height="${im.height}"><span>${String(i + 1).padStart(2, '0')}</span></button>`).join('');
    $('#main-image').addEventListener('error', () => {
      let error = $('.image-error');
      if (!error) { error = document.createElement('p'); error.className = 'image-error'; $('.image-stage').append(error); }
      error.textContent = '图片加载失败，请刷新页面后重试。';
    });
    renderImage();
  }
}
function renderImage() {
  if (!scene?.images.length) return;
  const im = scene.images[imageIndex];
  $('.image-error')?.remove();
  $('#main-image').src = im.src;
  $('#main-image').alt = `${scene.name} · ${im.label} · 原图对比`;
  $('#main-image').width = im.width;
  $('#main-image').height = im.height;
  $('#image-label').textContent = im.label;
  $('#view-counter').textContent = `${String(imageIndex + 1).padStart(2, '0')} / ${String(scene.images.length).padStart(2, '0')}`;
  $('#previous-view').disabled = scene.images.length < 2;
  $('#next-view').disabled = scene.images.length < 2;
  document.querySelectorAll('.thumb').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.index) === imageIndex)));
  selectedImages.set(sceneKey(), imageIndex);
  if (lightbox.open) renderLightbox();
}
function advance(delta) {
  if (!scene?.images.length) return;
  imageIndex = (imageIndex + delta + scene.images.length) % scene.images.length;
  renderImage();
}
function renderLightbox() {
  const im = scene.images[imageIndex];
  $('#lightbox-title').textContent = `${scene.name} / ${im.label}`;
  $('#lightbox-image').src = im.src;
  $('#lightbox-image').alt = `${scene.name} · ${im.label}`;
  $('#download-image').href = im.src;
  $('#lightbox-counter').textContent = `${imageIndex + 1} / ${scene.images.length}　·　← → 切换　Esc 关闭`;
  $('#previous-image').disabled = scene.images.length < 2;
  $('#next-image').disabled = scene.images.length < 2;
}
function openLightbox() {
  if (!scene?.images.length) return;
  renderLightbox(); lightbox.showModal();
}

function renderProgress() {
  const scenes = allScenes();
  const statuses = [['complete','迭代已结束'],['available','已有归档结果'],['running','构建中'],['attention','需复核 / 已中断'],['waiting','等待结果']];
  $('#status-totals').innerHTML = statuses.map(([key, label]) => `<div class="status-row"><span><i class="dot ${key}"></i>${label}</span><b>${scenes.filter(s => s.state === key).length}</b></div>`).join('');
  $('#collection-progress').innerHTML = data.collections.map(c => {
    const available = c.scenes.filter(s => s.images.length).length;
    const percentage = c.scenes.length ? Math.round(available / c.scenes.length * 100) : 0;
    return `<article class="collection-row"><div><strong>${escapeHTML(c.name)}</strong><b>${percentage}%</b></div><div class="coverage" role="progressbar" aria-label="${escapeHTML(c.name)}有图场景占比" aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="100"><span style="width:${percentage}%"></span></div><p>${available} / ${c.scenes.length} 个场景已有图片 · ${c.scenes.reduce((sum, s) => sum + s.images.length, 0)} 张精选对比图</p><a href="?part=${c.id}#gallery" data-browse="${c.id}">查看集合 ↗</a></article>`;
  }).join('');
  renderChart();
}
function renderChart() {
  const stats = data.stats[$('#chart-kind').value] || {days:[]};
  const days = stats.days || [];
  $('#chart-metrics').innerHTML = [['今日完成',stats.today],['累计完成',stats.total],['记录天数',days.length]].map(([label,count]) => `<div>${label}<strong>${number(count)}</strong></div>`).join('');
  if (!days.length) { $('#daily-chart').innerHTML = '<p class="muted">暂无每日统计记录。</p>'; $('#daily-rows').innerHTML = ''; return; }
  const width = 760, height = 195, left = 32, right = 22, top = 22, bottom = 32;
  const maximum = Math.max(4, ...days.map(d => d.count));
  const x = i => left + (days.length === 1 ? .5 : i / (days.length - 1)) * (width - left - right);
  const y = value => top + (1 - value / maximum) * (height - top - bottom);
  let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="每日场景完成数量，共 ${days.length} 天，累计 ${stats.total} 个"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#adc992" stop-opacity=".35"/><stop offset="100%" stop-color="#adc992" stop-opacity="0"/></linearGradient></defs>`;
  for (let i = 0; i < 4; i++) {
    const count = Math.round(maximum * i / 3);
    svg += `<path d="M${left},${y(count)}H${width-right}" stroke="#e1e7d8" stroke-dasharray="3 4"/><text x="${left-9}" y="${y(count)+3}" text-anchor="end">${count}</text>`;
  }
  svg += `<path d="M${x(0)},${y(0)}L${days.map((d,i) => `${x(i)},${y(d.count)}`).join('L')}L${x(days.length-1)},${y(0)}Z" fill="url(#chart-fill)"/>`;
  days.forEach((d,i) => {
    if (i) svg += `<path d="M${x(i-1)},${y(days[i-1].count)}L${x(i)},${y(d.count)}" fill="none" stroke="#658c54" stroke-width="2" ${d.finalized ? '' : 'stroke-dasharray="5 4"'}/>`;
    svg += `<circle cx="${x(i)}" cy="${y(d.count)}" r="4" fill="${d.finalized ? '#658c54' : '#f8faf3'}" stroke="#658c54" stroke-width="1.5"><title>${escapeHTML(d.date)} · ${d.count} 个${d.finalized ? '' : ' · 截至快照'}</title></circle><text x="${x(i)}" y="${y(d.count)-10}" text-anchor="middle">${d.count}</text>`;
    if (i % Math.max(1, Math.ceil(days.length / 10)) === 0 || i === days.length - 1) svg += `<text x="${x(i)}" y="${height-9}" text-anchor="middle">${escapeHTML(d.date.slice(5))}</text>`;
  });
  $('#daily-chart').innerHTML = svg + '</svg>';
  $('#daily-rows').innerHTML = days.slice().reverse().map(d => `<tr><td>${escapeHTML(d.date)}${d.finalized ? '' : ' · 截至快照'}</td><td>${d.count}</td><td>${(d.scene_ids || []).map(id => escapeHTML(id) + ((d.estimated_scene_ids || []).includes(id) ? '*' : '')).join('、') || '—'}</td></tr>`).join('');
}

document.addEventListener('click', event => {
  const tab = event.target.closest('[data-collection]');
  if (tab) { chooseCollection(tab.dataset.collection); return; }
  const sceneButton = event.target.closest('[data-scene]');
  if (sceneButton) { chooseScene(sceneButton.dataset.scene); return; }
  const thumb = event.target.closest('[data-index]');
  if (thumb) { imageIndex = Number(thumb.dataset.index); renderImage(); return; }
  if (event.target.closest('.open-image')) openLightbox();
  if (event.target.closest('#previous-view')) advance(-1);
  if (event.target.closest('#next-view')) advance(1);
  const browse = event.target.closest('[data-browse]');
  if (browse) { event.preventDefault(); chooseCollection(browse.dataset.browse); window.scrollTo({top:0}); }
});
$('#collection-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault();
  const i = data.collections.indexOf(collection);
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? data.collections.length - 1 : (i + (event.key === 'ArrowLeft' ? -1 : 1) + data.collections.length) % data.collections.length;
  chooseCollection(data.collections[index].id);
  $(`[data-collection="${collection.id}"]`).focus();
});
$('#search').addEventListener('input', event => { query = event.target.value; renderSceneList(); });
$('#status-filter').addEventListener('change', event => { filter = event.target.value; renderSceneList(); });
$('#chart-kind').addEventListener('change', renderChart);
$('#close-lightbox').addEventListener('click', () => lightbox.close());
$('#previous-image').addEventListener('click', () => advance(-1));
$('#next-image').addEventListener('click', () => advance(1));
lightbox.addEventListener('click', event => { if (event.target === lightbox) lightbox.close(); });
document.addEventListener('keydown', event => {
  if (lightbox.open && ['ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); advance(event.key === 'ArrowLeft' ? -1 : 1); }
});
window.addEventListener('hashchange', () => { if (data) showPage(); });
window.addEventListener('popstate', restoreURL);

async function load() {
  try {
    const response = await fetch('data.json');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    data = await response.json();
    if (data.schema_version !== 1 || !data.collections?.length) throw new Error('Invalid catalog');
    renderOverview(); restoreURL(); $('#load-status').hidden = true;
  } catch (error) {
    console.error('Could not load gallery:', error);
    $('#load-status').textContent = '场景目录暂时无法加载。';
    const retry = document.createElement('button'); retry.textContent = '重新加载'; retry.addEventListener('click', () => location.reload()); $('#load-status').append(retry);
  }
}
load();
