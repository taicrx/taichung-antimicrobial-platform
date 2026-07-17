from pathlib import Path

app_js = r'''const DATA = window.ANTIMICROBIAL_APP_DATA;

const state = {
  mode: 'drug',
  query: '',
  selectedConcept: null,
  selectedProduct: null,
  group: 'all',
  className: 'all',
  alpha: 'all',
  sort: 'generic',
  modality: 'HD',
  limit: 20
};

const $ = (selector) => document.querySelector(selector);

const esc = (value = '') =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      })[char]
  );

const norm = (value = '') =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');

const statusLabel = (status) =>
  ({
    allowed: '可使用',
    not_recommended: '不建議使用',
    no_data: '無資料 N/D',
    compatible: '相容',
    conditional: '條件式相容',
    incompatible: '不相容',
    uncertain: '不確定',
    instruction: '依指示'
  })[status] || status || 'N/D';

const groupLabel = (group) =>
  ({
    all: '全部',
    Antibacterial: '抗細菌',
    Antifungal: '抗黴菌',
    Antiviral: '抗病毒',
    'Anti-TB': '抗結核'
  })[group] || group || '其他';

function safeSetText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value ?? '';
}

function formatDateTime(value) {
  if (!value) return 'N/D';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function initialOf(drug) {
  return (drug?.genericName || '#').trim().charAt(0).toUpperCase();
}

function alphaMatch(initial, band) {
  if (band === 'all') return true;

  const code = initial.charCodeAt(0);

  if (band === 'A-F') return code >= 65 && code <= 70;
  if (band === 'G-L') return code >= 71 && code <= 76;
  if (band === 'M-R') return code >= 77 && code <= 82;
  if (band === 'S-Z') return code >= 83 && code <= 90;

  return true;
}

function searchable(drug) {
  const products = Array.isArray(drug?.products) ? drug.products : [];
  const aliases = Array.isArray(drug?.aliases) ? drug.aliases : [];

  return norm(
    [
      drug?.genericName,
      drug?.className,
      drug?.mechanism,
      drug?.group,
      ...aliases,
      ...products.flatMap((product) => [
        product?.brandName,
        product?.hospitalDrugId,
        product?.procedureCode,
        product?.strength
      ])
    ].join(' ')
  );
}

function filteredDrugs() {
  let drugs = Array.isArray(DATA?.drugs) ? [...DATA.drugs] : [];

  if (state.group !== 'all') {
    drugs = drugs.filter((drug) => drug.group === state.group);
  }

  if (state.className !== 'all') {
    drugs = drugs.filter((drug) => drug.className === state.className);
  }

  if (state.alpha !== 'all') {
    drugs = drugs.filter((drug) =>
      alphaMatch(initialOf(drug), state.alpha)
    );
  }

  const query = norm(state.query);

  if (query) {
    drugs = drugs.filter((drug) => searchable(drug).includes(query));
  }

  drugs.sort((a, b) => {
    if (state.sort === 'brand') {
      return (a.products?.[0]?.brandName || '').localeCompare(
        b.products?.[0]?.brandName || '',
        'en'
      );
    }

    if (state.sort === 'class') {
      return (
        (a.className || '').localeCompare(b.className || '', 'en') ||
        (a.genericName || '').localeCompare(b.genericName || '', 'en')
      );
    }

    return (a.genericName || '').localeCompare(
      b.genericName || '',
      'en'
    );
  });

  return drugs;
}

function renderGroups() {
  const container = $('#groupFilters');
  if (!container) return;

  const groups = [
    'all',
    ...new Set((DATA.drugs || []).map((drug) => drug.group).filter(Boolean))
  ];

  container.innerHTML = groups
    .map(
      (group) => `
        <button
          class="filter-chip ${state.group === group ? 'active' : ''}"
          data-group="${esc(group)}"
        >
          ${esc(groupLabel(group))}
        </button>
      `
    )
    .join('');

  container.querySelectorAll('[data-group]').forEach((button) => {
    button.addEventListener('click', () => {
      state.group = button.dataset.group;
      state.className = 'all';
      state.limit = 20;
      renderDrugMode();
    });
  });
}

function renderClasses() {
  const select = $('#classFilter');
  if (!select) return;

  const pool = (DATA.drugs || []).filter(
    (drug) => state.group === 'all' || drug.group === state.group
  );

  const classes = [
    ...new Set(pool.map((drug) => drug.className).filter(Boolean))
  ].sort();

  select.innerHTML = `
    <option value="all">全部藥理分類</option>
    ${classes
      .map(
        (className) =>
          `<option value="${esc(className)}">${esc(className)}</option>`
      )
      .join('')}
  `;

  select.value = classes.includes(state.className)
    ? state.className
    : 'all';
}

function listHTML(items) {
  let currentLetter = '';

  return items
    .map((drug) => {
      const letter = initialOf(drug);
      const heading =
        letter !== currentLetter
          ? `<div class="letter-heading">${esc(letter)}</div>`
          : '';

      currentLetter = letter;

      const adultDoses = Array.isArray(drug.adultDoses)
        ? drug.adultDoses
        : [];

      const hasDose = adultDoses.some(
        (row) =>
          row?.dose_display &&
          row.dose_display !== 'N/D' &&
          row.dose_display !== '無資料（N/D）'
      );

      const brands = (drug.products || [])
        .map((product) => product.brandName)
        .filter(Boolean)
        .join('、');

      return `
        ${heading}
        <button
          class="result-item ${
            state.selectedConcept === drug.conceptId ? 'active' : ''
          }"
          data-concept-id="${esc(drug.conceptId)}"
        >
          <div class="generic">${esc(drug.genericName)}</div>
          <div class="brands">${esc(brands)}</div>
          <div class="meta">
            <span class="badge ${hasDose ? '' : 'nd'}">
              ${hasDose ? '有劑量資料' : '部分資料 N/D'}
            </span>
            <span>${esc(drug.className)}</span>
          </div>
        </button>
      `;
    })
    .join('');
}

function renderDrugList() {
  const resultList = $('#resultList');
  const showMore = $('#showMore');

  if (!resultList) return;

  const all = filteredDrugs();
  const shown = all.slice(0, state.limit);

  const productCount = all.reduce(
    (count, drug) => count + (drug.products?.length || 0),
    0
  );

  safeSetText('#sidebarTitle', '藥品');
  safeSetText(
    '#resultCount',
    `符合 ${all.length} 種成分／${productCount} 個品項`
  );

  resultList.innerHTML =
    listHTML(shown) ||
    '<div class="backlog-box">沒有符合的藥品。</div>';

  if (showMore) {
    showMore.style.display = all.length > state.limit ? 'block' : 'none';
  }

  resultList.querySelectorAll('[data-concept-id]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedConcept = button.dataset.conceptId;

      const drug = DATA.drugs.find(
        (item) => item.conceptId === state.selectedConcept
      );

      state.selectedProduct =
        drug?.products?.[0]?.hospitalDrugId || null;

      renderDrugDetail();
      renderDrugList();

      if (window.innerWidth < 1050) {
        $('#content')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });
}

function section(title, body, open = true) {
  return `
    <section class="section ${open ? '' : 'collapsed'}">
      <button class="section-title" type="button">
        <span>${title}</span>
        <span>⌄</span>
      </button>
      <div class="section-body">${body}</div>
    </section>
  `;
}

function refBadges(value) {
  if (!value) return '';

  const refs = String(value)
    .split(/[;,；]/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!refs.length) return '';

  return `
    <div class="source-row">
      ${refs
        .map(
          (ref) =>
            `<span class="source-badge">${esc(ref)}</span>`
        )
        .join('')}
    </div>
  `;
}

function routeCards(drug, hospitalDrugId) {
  const rows = (drug.administration || []).filter(
    (row) => row.hospital_drug_id === hospitalDrugId
  );

  return `
    <div class="route-grid">
      ${['IV push', 'IM', 'IV infusion']
        .map((route) => {
          const row =
            rows.find((item) => item.route === route) || {
              status: 'no_data'
            };

          return `
            <div class="route-card ${esc(row.status)}">
              <h3>${esc(route)}</h3>
              <div class="route-status">${esc(
                statusLabel(row.status)
              )}</div>
              ${
                row.administration_instruction
                  ? `<div class="route-detail">${esc(
                      row.administration_instruction
                    )}</div>`
                  : ''
              }
              ${
                row.maximum_rate_display
                  ? `<div class="route-detail">最大速率：${esc(
                      row.maximum_rate_display
                    )}</div>`
                  : ''
              }
              ${refBadges(row.reference_display)}
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function doseSection(drug) {
  const rows = Array.isArray(drug.adultDoses)
    ? drug.adultDoses
    : [];

  const body = rows.length
    ? rows
        .map(
          (row) => `
            <div class="info-card">
              <div class="label">
                ${esc(row.indication)}｜${esc(row.renal_category)}
              </div>
              <h4>${esc(row.dose_display || 'N/D')}</h4>
              ${
                row.loading_dose_display
                  ? `<p><strong>Loading：</strong>${esc(
                      row.loading_dose_display
                    )}</p>`
                  : ''
              }
              ${
                row.special_note
                  ? `<p>${esc(row.special_note)}</p>`
                  : ''
              }
              <p class="label">
                ${esc(row.review_status)}｜${esc(row.source_id)}
              </p>
            </div>
          `
        )
        .join('')
    : '<div class="backlog-box">目前無一般成人或腎功能劑量資料。</div>';

  return section(
    '一般成人與腎功能劑量',
    `<div class="data-grid">${body}</div>`
  );
}

function rrtSection(drug) {
  const modalities = ['HD', 'PD', 'CVVH', 'CVVHDF', 'ECMO'];

  const row =
    (drug.rrtDoses || []).find(
      (item) => item.modality === state.modality
    ) || {};

  return section(
    '特殊族群劑量（HD／PD／CRRT／ECMO）',
    `
      <div class="pop-tabs">
        ${modalities
          .map(
            (modality) => `
              <button
                class="pop-tab ${
                  state.modality === modality ? 'active' : ''
                }"
                data-modality="${modality}"
              >
                ${modality}
              </button>
            `
          )
          .join('')}
      </div>

      <div class="info-card">
        <div class="label">
          ${esc(state.modality)}｜${esc(row.status || 'no_data')}
        </div>
        <h4>${esc(row.dose_display || 'N/D')}</h4>
        ${
          row.usual_dose_display
            ? `<p>一般劑量：${esc(row.usual_dose_display)}</p>`
            : ''
        }
        ${row.note ? `<p>${esc(row.note)}</p>` : ''}
        ${refBadges(row.reference_text)}
      </div>
    `
  );
}

function compatibilityBlock(rows) {
  if (!rows.length) {
    return '<div class="backlog-box">此院內品項目前無資料。</div>';
  }

  return `
    <div class="compat-grid">
      ${rows
        .map(
          (row) => `
            <div class="compat-item ${esc(row.status)}">
              <strong>
                ${esc(row.solution_code)}｜${esc(
                  statusLabel(row.status)
                )}
              </strong>
              ${
                row.condition_display
                  ? `<div class="condition">${esc(
                      row.condition_display
                    )}</div>`
                  : ''
              }
              ${refBadges(row.reference_display)}
            </div>
          `
        )
        .join('')}
    </div>
  `;
}

function preparationSection(drug, hospitalDrugId) {
  const compatibility = (drug.compatibility || []).filter(
    (row) => row.hospital_drug_id === hospitalDrugId
  );

  const stability = (drug.stability || []).filter(
    (row) => row.hospital_drug_id === hospitalDrugId
  );

  const stabilityCards = stability.length
    ? stability
        .map(
          (row) => `
            <div class="info-card">
              <div class="label">
                ${esc(row.storage_condition)}｜${esc(row.status)}
              </div>
              <h4>${esc(row.duration_display || 'N/D')}</h4>
              ${
                row.special_condition
                  ? `<div class="stability-note">${esc(
                      row.special_condition
                    )}</div>`
                  : ''
              }
              ${refBadges(row.reference_display)}
            </div>
          `
        )
        .join('')
    : '<div class="backlog-box">此院內品項目前無保存時效資料。</div>';

  return section(
    '調製、稀釋液相容性與保存時效',
    `
      <h4>重組液</h4>
      ${compatibilityBlock(
        compatibility.filter(
          (row) => row.phase === 'Reconstitution'
        )
      )}

      <h4 style="margin-top:16px">稀釋液</h4>
      ${compatibilityBlock(
        compatibility.filter((row) => row.phase === 'Dilution')
      )}

      <h4 style="margin-top:16px">保存時效</h4>
      <div class="data-grid">${stabilityCards}</div>
    `
  );
}

function pkSection(drug) {
  const rows = Array.isArray(drug.pkpd) ? drug.pkpd : [];

  const body = rows.length
    ? rows
        .map(
          (row) => `
            <div class="info-card">
              <div class="label">${esc(row.parameter_name)}</div>
              <h4>${esc(row.value_display || 'N/D')}</h4>
              ${
                row.component_scope
                  ? `<p>${esc(row.component_scope)}</p>`
                  : ''
              }
            </div>
          `
        )
        .join('')
    : '<div class="backlog-box">目前無PK／PD資料。</div>';

  return section(
    'PK／PD與透析特性',
    `<div class="data-grid">${body}</div>`,
    false
  );
}

function dxSection(drug) {
  const rows = Array.isArray(drug.diagnoses)
    ? drug.diagnoses
    : [];

  const body = rows.length
    ? rows
        .map(
          (row) => `
            <div class="dx-card">
              <h3>
                ${esc(row.diagnosis)}
                ${
                  row.severity
                    ? `<span class="badge">${esc(
                        row.severity
                      )}</span>`
                    : ''
                }
              </h3>
              <div class="dx-row">
                <div class="dx-label">首選</div>
                <div>${esc(row.firstLine)}</div>
              </div>
              <div class="dx-row">
                <div class="dx-label">替代</div>
                <div>${esc(row.alternative || '—')}</div>
              </div>
            </div>
          `
        )
        .join('')
    : '<div class="backlog-box">目前診斷群指引未連結此成分。</div>';

  return section(
    '本院診斷群指引中的連結',
    `<div class="dx-list">${body}</div>`,
    false
  );
}

function renderDrugDetail() {
  const content = $('#content');
  if (!content) return;

  const drug = DATA.drugs.find(
    (item) => item.conceptId === state.selectedConcept
  );

  if (!drug) {
    content.innerHTML = `
      <div class="empty-state">
        <div>
          <h2>選擇藥品開始查詢</h2>
          <p>可搜尋學名、商品名、處置代碼、縮寫，或使用分類與A–Z。</p>
        </div>
      </div>
    `;
    return;
  }

  if (
    !state.selectedProduct ||
    !drug.products?.some(
      (product) =>
        product.hospitalDrugId === state.selectedProduct
    )
  ) {
    state.selectedProduct =
      drug.products?.[0]?.hospitalDrugId || null;
  }

  const product =
    drug.products?.find(
      (item) => item.hospitalDrugId === state.selectedProduct
    ) || drug.products?.[0];

  if (!product) {
    content.innerHTML =
      '<div class="backlog-box">此成分沒有可顯示的院內品項。</div>';
    return;
  }

  content.innerHTML = `
    <div class="drug-header">
      <div class="drug-title">
        <span class="badge">
          ${esc(groupLabel(drug.group))}｜${esc(drug.className)}
        </span>

        <h2>${esc(drug.genericName)}</h2>
        <p>${esc(drug.mechanism || '')}</p>

        <div class="product-picker">
          <label>
            院內品項
            <select id="productSelect" class="product-select">
              ${(drug.products || [])
                .map(
                  (item) => `
                    <option
                      value="${esc(item.hospitalDrugId)}"
                      ${
                        item.hospitalDrugId ===
                        product.hospitalDrugId
                          ? 'selected'
                          : ''
                      }
                    >
                      ${esc(item.brandName)}｜
                      ${esc(item.hospitalDrugId)}｜
                      ${esc(item.strength || 'N/D')}
                    </option>
                  `
                )
                .join('')}
            </select>
          </label>
        </div>
      </div>

      <div class="review-box">
        <strong>
          ${esc(product.brandName)}｜
          ${esc(product.hospitalDrugId)}
        </strong>
        <br>
        資料版本：${esc(DATA.meta.datasetVersion)}
        <br>
        資料發布：${esc(
          formatDateTime(DATA.meta.datasetPublishedAt)
        )}
      </div>
    </div>

    ${routeCards(drug, product.hospitalDrugId)}
    ${doseSection(drug)}
    ${rrtSection(drug)}
    ${preparationSection(drug, product.hospitalDrugId)}
    ${pkSection(drug)}
    ${dxSection(drug)}
  `;

  $('#productSelect')?.addEventListener('change', (event) => {
    state.selectedProduct = event.target.value;
    renderDrugDetail();
  });

  content.querySelectorAll('.section-title').forEach((button) => {
    button.addEventListener('click', () => {
      button.parentElement.classList.toggle('collapsed');
    });
  });

  content.querySelectorAll('[data-modality]').forEach((button) => {
    button.addEventListener('click', () => {
      state.modality = button.dataset.modality;
      renderDrugDetail();
    });
  });
}

function renderDrugMode() {
  const filterPanel = $('#filterPanel');
  if (filterPanel) filterPanel.style.display = '';

  renderGroups();
  renderClasses();

  if ($('#alphaFilter')) $('#alphaFilter').value = state.alpha;
  if ($('#sortFilter')) $('#sortFilter').value = state.sort;

  renderDrugList();
  renderDrugDetail();
}

function renderDiagnosis() {
  const filterPanel = $('#filterPanel');
  const showMore = $('#showMore');
  const resultList = $('#resultList');
  const content = $('#content');

  if (filterPanel) filterPanel.style.display = 'none';
  if (showMore) showMore.style.display = 'none';
  if (!resultList || !content) return;

  const query = norm(state.query);

  const diagnoses = (DATA.diagnoses || []).filter((row) => {
    if (!query) return true;

    return norm(
      [
        row.diagnosis,
        row.severity,
        row.first_line_regimen,
        row.alternative_regimen
      ].join(' ')
    ).includes(query);
  });

  safeSetText('#sidebarTitle', '診斷群');
  safeSetText('#resultCount', `符合 ${diagnoses.length} 筆`);

  resultList.innerHTML = diagnoses
    .map(
      (row) => `
        <button
          class="result-item"
          data-diagnosis-id="${esc(row.guideline_id)}"
        >
          <div class="generic">${esc(row.diagnosis)}</div>
          <div class="brands">${esc(row.severity || '')}</div>
        </button>
      `
    )
    .join('');

  content.innerHTML = `
    <div class="drug-header">
      <div class="drug-title">
        <span class="badge">診斷群查詢</span>
        <h2>本院經驗性抗生素指引</h2>
        <p>實際處置仍應依感染部位、培養結果、過敏史、器官功能及院內正式規範判斷。</p>
      </div>
    </div>

    <div class="dx-list" style="margin-top:17px">
      ${diagnoses
        .map((row) => {
          const links = (row.links || [])
            .filter((link) => link.link_type === 'Drug concept')
            .map((link) => {
              const drug = DATA.drugs.find(
                (item) => item.conceptId === link.linked_id
              );

              if (!drug) return '';

              return `
                <button
                  class="link-drug"
                  data-drug-id="${esc(drug.conceptId)}"
                >
                  ${esc(drug.genericName)}
                </button>
              `;
            })
            .join('');

          return `
            <div class="dx-card" id="${esc(row.guideline_id)}">
              <h3>
                ${esc(row.diagnosis)}
                ${
                  row.severity
                    ? `<span class="badge">${esc(
                        row.severity
                      )}</span>`
                    : ''
                }
              </h3>

              <div class="dx-row">
                <div class="dx-label">首選</div>
                <div>${esc(row.first_line_regimen)}</div>
              </div>

              <div class="dx-row">
                <div class="dx-label">替代</div>
                <div>${esc(row.alternative_regimen || '—')}</div>
              </div>

              ${links}
            </div>
          `;
        })
        .join('')}
    </div>
  `;

  resultList
    .querySelectorAll('[data-diagnosis-id]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        document
          .getElementById(button.dataset.diagnosisId)
          ?.scrollIntoView({ behavior: 'smooth' });
      });
    });

  content.querySelectorAll('[data-drug-id]').forEach((button) => {
    button.addEventListener('click', () => {
      state.mode = 'drug';
      state.selectedConcept = button.dataset.drugId;

      const drug = DATA.drugs.find(
        (item) => item.conceptId === state.selectedConcept
      );

      state.selectedProduct =
        drug?.products?.[0]?.hospitalDrugId || null;

      render();
    });
  });
}

function renderSpecial() {
  const modalities = ['HD', 'PD', 'CVVH', 'CVVHDF', 'ECMO'];
  const filterPanel = $('#filterPanel');
  const showMore = $('#showMore');
  const resultList = $('#resultList');
  const content = $('#content');

  if (filterPanel) filterPanel.style.display = 'none';
  if (showMore) showMore.style.display = 'none';
  if (!resultList || !content) return;

  safeSetText('#sidebarTitle', '特殊族群');
  safeSetText('#resultCount', '5 modalities');

  resultList.innerHTML = modalities
    .map(
      (modality) => `
        <button
          class="result-item ${
            state.modality === modality ? 'active' : ''
          }"
          data-special-modality="${modality}"
        >
          <div class="generic">${modality}</div>
        </button>
      `
    )
    .join('');

  const cards = (DATA.drugs || [])
    .map((drug) => {
      const row = (drug.rrtDoses || []).find(
        (item) => item.modality === state.modality
      );

      return `
        <div class="info-card">
          <div class="label">${esc(drug.genericName)}</div>
          <h4>${esc(row?.dose_display || 'N/D')}</h4>
          ${row?.note ? `<p>${esc(row.note)}</p>` : ''}
          <button
            class="link-drug"
            data-special-drug="${esc(drug.conceptId)}"
          >
            開啟完整藥品頁
          </button>
        </div>
      `;
    })
    .join('');

  content.innerHTML = `
    <div class="drug-header">
      <div class="drug-title">
        <span class="badge">特殊族群比較</span>
        <h2>${esc(state.modality)}劑量總覽</h2>
        <p>無資料固定顯示N/D，不代表不需調整。</p>
      </div>
    </div>

    <div class="data-grid" style="margin-top:17px">
      ${cards}
    </div>
  `;

  resultList
    .querySelectorAll('[data-special-modality]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        state.modality = button.dataset.specialModality;
        renderSpecial();
      });
    });

  content.querySelectorAll('[data-special-drug]').forEach((button) => {
    button.addEventListener('click', () => {
      state.mode = 'drug';
      state.selectedConcept = button.dataset.specialDrug;

      const drug = DATA.drugs.find(
        (item) => item.conceptId === state.selectedConcept
      );

      state.selectedProduct =
        drug?.products?.[0]?.hospitalDrugId || null;

      render();
    });
  });
}

function activeMode() {
  document.querySelectorAll('.mode-tab').forEach((button) => {
    button.classList.toggle(
      'active',
      button.dataset.mode === state.mode
    );
  });
}

function render() {
  activeMode();

  if (state.mode === 'drug') {
    renderDrugMode();
    return;
  }

  if (state.mode === 'diagnosis') {
    renderDiagnosis();
    return;
  }

  renderSpecial();
}

function bindStaticEvents() {
  document.querySelectorAll('.mode-tab').forEach((button) => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode;
      state.limit = 20;
      render();
    });
  });

  $('#search')?.addEventListener('input', (event) => {
    state.query = event.target.value;
    state.limit = 20;

    const clearButton = $('#clearSearch');
    if (clearButton) {
      clearButton.style.display = state.query ? 'block' : 'none';
    }

    render();
  });

  $('#clearSearch')?.addEventListener('click', () => {
    state.query = '';

    const search = $('#search');
    if (search) search.value = '';

    const clearButton = $('#clearSearch');
    if (clearButton) clearButton.style.display = 'none';

    state.limit = 20;
    render();
  });

  $('#classFilter')?.addEventListener('change', (event) => {
    state.className = event.target.value;
    state.limit = 20;
    renderDrugMode();
  });

  $('#alphaFilter')?.addEventListener('change', (event) => {
    state.alpha = event.target.value;
    state.limit = 20;
    renderDrugMode();
  });

  $('#sortFilter')?.addEventListener('change', (event) => {
    state.sort = event.target.value;
    state.limit = 20;
    renderDrugMode();
  });

  $('#showMore')?.addEventListener('click', () => {
    state.limit += 20;
    renderDrugList();
  });

  $('#mobileFilterToggle')?.addEventListener('click', () => {
    $('#filterPanel')?.classList.toggle('open');
  });
}

function initializeMeta() {
  const actualProductCount = (DATA.drugs || []).reduce(
    (count, drug) => count + (drug.products?.length || 0),
    0
  );

  const actualConceptCount = new Set(
    (DATA.drugs || []).map((drug) => drug.conceptId)
  ).size;

  safeSetText(
    '#totalStats',
    `收錄 ${actualProductCount} 個現行院內品項／${actualConceptCount} 種成分`
  );

  safeSetText(
    '#publishedMeta',
    `資料發布：${formatDateTime(DATA.meta.datasetPublishedAt)}`
  );

  safeSetText(
    '#versionMeta',
    `資料版本：${DATA.meta.datasetVersion}｜平台版本：${DATA.meta.appVersion}`
  );

  if (
    DATA.meta.productCount !== undefined &&
    DATA.meta.productCount !== actualProductCount
  ) {
    console.warn(
      'productCount mismatch',
      DATA.meta.productCount,
      actualProductCount
    );
  }

  if (
    DATA.meta.conceptCount !== undefined &&
    DATA.meta.conceptCount !== actualConceptCount
  ) {
    console.warn(
      'conceptCount mismatch',
      DATA.meta.conceptCount,
      actualConceptCount
    );
  }
}

function initialize() {
  try {
    if (!DATA || !Array.isArray(DATA.drugs)) {
      throw new Error('找不到有效的ANTIMICROBIAL_APP_DATA。');
    }

    initializeMeta();
    bindStaticEvents();
    render();
  } catch (error) {
    console.error(error);

    const content = $('#content');

    if (content) {
      content.innerHTML = `
        <div class="backlog-box">
          網頁初始化失敗：${esc(error.message || String(error))}
        </div>
      `;
    }
  }
}

initialize();
'''

output = Path("/mnt/data/app.js")
output.write_text(app_js, encoding="utf-8")
print(output, output.stat().st_size)
