/**
 * 臺中醫院抗感染製劑資訊平台 — Google Sheet → GitHub publisher
 * Bound script: 在資料庫 Google Sheet 內選 Extensions → Apps Script。
 */
const REQUIRED_SHEETS = [
  'App_Config','Drug_Master','Drug_Alias','Dose_Adult','RRT_Dose','Administration',
  'Compatibility','Stability','PKPD','Diagnosis_Guideline','Diagnosis_Drug_Link',
  'Reference_Master','Data_Quality_Issues','Publish_Log'
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('抗感染平台')
    .addItem('1. 檢查資料庫', 'validateDatabase')
    .addItem('2. 預覽發布摘要', 'previewPublishSummary')
    .addSeparator()
    .addItem('3. 設定 GitHub 連線', 'configureGitHub')
    .addItem('4. 檢查 GitHub 設定', 'showGitHubConfiguration')
    .addSeparator()
    .addItem('5. 發布資料到 GitHub', 'publishDataToGitHub')
    .addToUi();
}

function configureGitHub() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const prompts = [
    ['GITHUB_OWNER', 'GitHub帳號或organization名稱', props.getProperty('GITHUB_OWNER') || ''],
    ['GITHUB_REPO', 'Repository名稱', props.getProperty('GITHUB_REPO') || 'taichung-antimicrobial-platform'],
    ['GITHUB_BRANCH', 'Branch名稱', props.getProperty('GITHUB_BRANCH') || getConfig_('GITHUB_BRANCH') || 'main'],
    ['GITHUB_TOKEN', 'Fine-grained token（只存Script Properties，不會寫入試算表）', ''],
    ['GITHUB_PAGES_URL', 'GitHub Pages網址（可先留空）', props.getProperty('GITHUB_PAGES_URL') || '']
  ];
  prompts.forEach(([key, label, defaultValue]) => {
    const response = ui.prompt('設定 GitHub', label, ui.ButtonSet.OK_CANCEL);
    if (response.getSelectedButton() !== ui.Button.OK) throw new Error('使用者取消設定。');
    const value = response.getResponseText().trim() || defaultValue;
    if (value) props.setProperty(key, value);
  });
  ui.alert('GitHub設定已儲存。Token只存在Apps Script的Script Properties。');
}

function showGitHubConfiguration() {
  const p = PropertiesService.getScriptProperties();
  const text = [
    `Owner: ${p.getProperty('GITHUB_OWNER') || '未設定'}`,
    `Repo: ${p.getProperty('GITHUB_REPO') || '未設定'}`,
    `Branch: ${p.getProperty('GITHUB_BRANCH') || '未設定'}`,
    `Token: ${p.getProperty('GITHUB_TOKEN') ? '已設定' : '未設定'}`,
    `Pages URL: ${p.getProperty('GITHUB_PAGES_URL') || '未設定'}`
  ].join('\n');
  SpreadsheetApp.getUi().alert('GitHub連線狀態', text, SpreadsheetApp.getUi().ButtonSet.OK);
}

function validateDatabase() {
  const result = validateDatabase_();
  const text = [
    `Errors: ${result.errors.length}`,
    `Warnings: ${result.warnings.length}`,
    '',
    ...result.errors.map(x => `ERROR: ${x}`),
    ...result.warnings.map(x => `WARNING: ${x}`)
  ].join('\n');
  SpreadsheetApp.getUi().alert('資料庫檢查', text || '無問題', SpreadsheetApp.getUi().ButtonSet.OK);
  return result;
}

function previewPublishSummary() {
  const validation = validateDatabase_();
  if (validation.errors.length) throw new Error(validation.errors.join('\n'));
  const version = nextDataVersion_();
  const publishedAt = new Date().toISOString();
  const dataset = buildDataset_(version, publishedAt);
  SpreadsheetApp.getUi().alert(
    '發布摘要',
    `預計資料版本：${version}\n院內品項：${dataset.meta.productCount}\n成分：${dataset.meta.conceptCount}\nOpen High issues：${validation.openHighIssues}\n\n此步驟尚未寫入GitHub。`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function publishDataToGitHub() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const validation = validateDatabase_();
    if (validation.errors.length) throw new Error(validation.errors.join('\n'));
    const blockHigh = String(getConfig_('BLOCK_ON_HIGH_ISSUES') || 'FALSE').toUpperCase() === 'TRUE';
    if (blockHigh && validation.openHighIssues > 0) {
      throw new Error(`目前有 ${validation.openHighIssues} 個Open High issue；App_Config已設定阻止發布。`);
    }
    const props = requireGitHubProperties_();
    const version = nextDataVersion_();
    const publishedAt = new Date().toISOString();
    const dataset = buildDataset_(version, publishedAt);
    const js = 'window.ANTIMICROBIAL_APP_DATA = ' + JSON.stringify(dataset, null, 2) + ';\n';
    const path = getConfig_('GITHUB_DATA_PATH') || 'data/data.js';
    const result = upsertGitHubFile_(props, path, js, `Publish antimicrobial dataset ${version}`);
    appendPublishLog_(dataset, result.commitSha || '');
    setConfig_('LAST_DATA_VERSION', version);
    setConfig_('LAST_PUBLISHED_AT', publishedAt);
    const url = props.GITHUB_PAGES_URL || `https://${props.GITHUB_OWNER}.github.io/${props.GITHUB_REPO}/`;
    SpreadsheetApp.getUi().alert('發布成功', `資料版本：${version}\n資料發布：${publishedAt}\nGitHub commit：${result.commitSha || '完成'}\n網站：${url}`, SpreadsheetApp.getUi().ButtonSet.OK);
  } finally {
    lock.releaseLock();
  }
}

function buildDataset_(version, publishedAt) {
  const products = rows_('Drug_Master').filter(r => isPublish_(r) && String(r.formulary_status).toLowerCase() === 'active');
  const productConcepts = new Set(products.map(r => r.drug_concept_id));
  const aliases = rows_('Drug_Alias').filter(r => isPublish_(r) && productConcepts.has(r.drug_concept_id));
  const doses = rows_('Dose_Adult').filter(r => isPublish_(r) && productConcepts.has(r.drug_concept_id));
  const rrt = rows_('RRT_Dose').filter(r => isPublish_(r) && productConcepts.has(r.drug_concept_id));
  const admin = rows_('Administration').filter(r => isPublish_(r) && productConcepts.has(r.drug_concept_id));
  const comp = rows_('Compatibility').filter(r => isPublish_(r) && productConcepts.has(r.drug_concept_id));
  const stability = rows_('Stability').filter(r => isPublish_(r) && productConcepts.has(r.drug_concept_id));
  const pkpd = rows_('PKPD').filter(r => isPublish_(r) && productConcepts.has(r.drug_concept_id));
  const dx = rows_('Diagnosis_Guideline').filter(isPublish_);
  const dxLinks = rows_('Diagnosis_Drug_Link').filter(isPublish_);
  const refs = rows_('Reference_Master');
  const issues = rows_('Data_Quality_Issues').filter(r => String(r.status).toLowerCase() === 'open');

  const byConcept = {};
  products.forEach(p => {
    if (!byConcept[p.drug_concept_id]) {
      byConcept[p.drug_concept_id] = {
        conceptId:p.drug_concept_id,genericName:p.standard_generic_name,group:p.antimicrobial_group,
        className:p.pharmacologic_class,mechanism:p.mechanism_group,products:[],aliases:[],adultDoses:[],
        rrtDoses:[],administration:[],compatibility:[],stability:[],pkpd:[],diagnoses:[]
      };
    }
    byConcept[p.drug_concept_id].products.push({
      hospitalDrugId:p.hospital_drug_id,procedureCode:p.procedure_code,brandName:p.brand_name,
      strength:p.strength_display,dosageForm:p.dosage_form,formulationAttribute:p.formulation_attribute,
      reviewStatus:p.review_status,publicationStatus:p.publication_status
    });
  });
  aliases.forEach(r => byConcept[r.drug_concept_id]?.aliases.push(r.alias_text));
  doses.forEach(r => byConcept[r.drug_concept_id]?.adultDoses.push(r));
  rrt.forEach(r => byConcept[r.drug_concept_id]?.rrtDoses.push(r));
  admin.forEach(r => byConcept[r.drug_concept_id]?.administration.push(r));
  comp.forEach(r => byConcept[r.drug_concept_id]?.compatibility.push(r));
  stability.forEach(r => byConcept[r.drug_concept_id]?.stability.push(r));
  pkpd.forEach(r => byConcept[r.drug_concept_id]?.pkpd.push(r));
  const dxById = Object.fromEntries(dx.map(d => [d.guideline_id,d]));
  dxLinks.filter(l => l.link_type === 'Drug concept').forEach(l => {
    const d = dxById[l.guideline_id];
    if (d && byConcept[l.linked_id]) byConcept[l.linked_id].diagnoses.push({
      guidelineId:d.guideline_id,diagnosis:d.diagnosis,severity:d.severity,firstLine:d.first_line_regimen,
      alternative:d.alternative_regimen,recommendationType:l.recommendation_type
    });
  });
  const drugs = Object.values(byConcept).sort((a,b) => a.genericName.localeCompare(b.genericName,'en'));
  return {
    meta:{
      title:getConfig_('APP_TITLE') || '臺中醫院抗感染製劑資訊平台',
      appVersion:getConfig_('APP_VERSION') || '1.0.0',datasetVersion:version,datasetPublishedAt:publishedAt,
      publicationMode:'Google Sheet publication_status=Publish',productCount:products.length,conceptCount:drugs.length,
      disclaimer:'本資料集為院內資料整合；正式臨床使用仍須依最新院內政策、仿單與臨床判斷。'
    },
    drugs,
    diagnoses:dx.map(d => ({...d,links:dxLinks.filter(l => l.guideline_id === d.guideline_id)})),
    references:refs,
    qualityAlerts:issues.filter(i => i.severity === 'High')
  };
}

function validateDatabase_() {
  const ss = SpreadsheetApp.getActive();
  const errors = [], warnings = [];
  REQUIRED_SHEETS.forEach(name => { if (!ss.getSheetByName(name)) errors.push(`缺少工作表：${name}`); });
  if (errors.length) return {errors,warnings,openHighIssues:0};
  const products = rows_('Drug_Master');
  const ids = products.map(r => r.hospital_drug_id).filter(Boolean);
  const duplicates = ids.filter((id,i) => ids.indexOf(id)!==i);
  if (duplicates.length) errors.push(`hospital_drug_id重複：${[...new Set(duplicates)].join(', ')}`);
  const concepts = new Set(products.map(r => r.drug_concept_id));
  ['Drug_Alias','Dose_Adult','RRT_Dose','Administration','Compatibility','Stability','PKPD'].forEach(name => {
    rows_(name).forEach((r,idx) => { if (r.drug_concept_id && !concepts.has(r.drug_concept_id)) errors.push(`${name} row ${idx+2}引用不存在的drug_concept_id：${r.drug_concept_id}`); });
  });
  const issues = rows_('Data_Quality_Issues').filter(r => String(r.status).toLowerCase()==='open');
  const high = issues.filter(r => r.severity === 'High').length;
  if (high) warnings.push(`尚有 ${high} 個Open High issue。`);
  const missingStrength = products.filter(r => !r.strength_display || r.strength_display === 'N/D').length;
  if (missingStrength) warnings.push(`${missingStrength} 個院內品項規格為N/D。`);
  return {errors,warnings,openHighIssues:high};
}

function rows_(sheetName) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet) throw new Error(`找不到工作表：${sheetName}`);
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  const headers = values[0].map(h => String(h).trim());
  return values.slice(1).filter(row => row.some(v => String(v).trim() !== '')).map(row => {
    const obj = {}; headers.forEach((h,i) => obj[h] = row[i]); return obj;
  });
}
function isPublish_(row){return String(row.publication_status || 'Publish').toLowerCase()==='publish';}
function configMap_(){return Object.fromEntries(rows_('App_Config').map(r => [r.config_key,r.config_value]));}
function getConfig_(key){return configMap_()[key] || '';}
function setConfig_(key,value){const sh=SpreadsheetApp.getActive().getSheetByName('App_Config');const vals=sh.getDataRange().getDisplayValues();for(let i=1;i<vals.length;i++){if(vals[i][0]===key){sh.getRange(i+1,2).setValue(value);return;}}throw new Error(`App_Config缺少：${key}`);}
function nextDataVersion_(){const tz=getConfig_('TIMEZONE')||'Asia/Taipei';const date=Utilities.formatDate(new Date(),tz,'yyyyMMdd');const prefix=`D${date}.`;const nums=rows_('Publish_Log').map(r=>String(r.data_version||'')).filter(v=>v.startsWith(prefix)).map(v=>Number(v.split('.')[1])).filter(Number.isFinite);return `${prefix}${nums.length?Math.max(...nums)+1:1}`;}
function requireGitHubProperties_(){const p=PropertiesService.getScriptProperties();const out={GITHUB_OWNER:p.getProperty('GITHUB_OWNER'),GITHUB_REPO:p.getProperty('GITHUB_REPO'),GITHUB_BRANCH:p.getProperty('GITHUB_BRANCH')||getConfig_('GITHUB_BRANCH')||'main',GITHUB_TOKEN:p.getProperty('GITHUB_TOKEN'),GITHUB_PAGES_URL:p.getProperty('GITHUB_PAGES_URL')||''};const missing=Object.entries(out).filter(([k,v])=>k!=='GITHUB_PAGES_URL'&&!v).map(([k])=>k);if(missing.length)throw new Error(`GitHub設定不完整：${missing.join(', ')}`);return out;}
function upsertGitHubFile_(p,path,content,message){const api=`https://api.github.com/repos/${encodeURIComponent(p.GITHUB_OWNER)}/${encodeURIComponent(p.GITHUB_REPO)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;const headers={Authorization:`Bearer ${p.GITHUB_TOKEN}`,Accept:'application/vnd.github+json'};let sha='';const get=UrlFetchApp.fetch(`${api}?ref=${encodeURIComponent(p.GITHUB_BRANCH)}`,{method:'get',headers,muteHttpExceptions:true});if(get.getResponseCode()===200)sha=JSON.parse(get.getContentText()).sha;else if(get.getResponseCode()!==404)throw new Error(`GitHub讀取失敗 ${get.getResponseCode()}: ${get.getContentText()}`);const body={message,content:Utilities.base64Encode(Utilities.newBlob(content,'text/plain','data.js').getBytes()),branch:p.GITHUB_BRANCH};if(sha)body.sha=sha;const put=UrlFetchApp.fetch(api,{method:'put',headers,contentType:'application/json',payload:JSON.stringify(body),muteHttpExceptions:true});if(![200,201].includes(put.getResponseCode()))throw new Error(`GitHub寫入失敗 ${put.getResponseCode()}: ${put.getContentText()}`);const json=JSON.parse(put.getContentText());return{commitSha:json.commit?.sha||'',contentSha:json.content?.sha||''};}
function appendPublishLog_(dataset,sha){const sh=SpreadsheetApp.getActive().getSheetByName('Publish_Log');const headers=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0];const row={publish_id:`PUB-${Date.now()}`,data_version:dataset.meta.datasetVersion,published_at:dataset.meta.datasetPublishedAt,published_by:Session.getEffectiveUser().getEmail()||'current user',publication_mode:dataset.meta.publicationMode,approved_record_count:'publication_status=Publish',product_count:dataset.meta.productCount,concept_count:dataset.meta.conceptCount,git_commit_sha:sha,status:'Success',notes:''};sh.appendRow(headers.map(h=>row[h]??''));}
