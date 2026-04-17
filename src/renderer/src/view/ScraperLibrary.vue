<template>
  <el-container class="power-grid-container">
    <el-header height="auto" class="grid-header glass-panel">
      <div class="header-content">
        <div class="title-group">
          <el-icon class="logo-icon"><Film /></el-icon>
          <div class="text">
            <h2>全员复刻工作台 (Pro Studio)</h2>
            <p>文案、多图、视频全链条复刻。一个原贴，无限衍生，支持 1:1 图片对照与视频预览。</p>
          </div>
        </div>
        <div class="filter-group">
          <!-- 自动化引擎开关 (新增) -->
          <el-button
            :type="pollerStatus.isPolling ? 'success' : 'info'"
            :icon="pollerStatus.isPolling ? 'VideoCamera' : 'Mute'"
            @click="togglePoller"
            style="margin-right: 15px;"
          >
            {{ pollerStatus.isPolling ? '云端队列监听: 运行中' : '云端队列监听: 已停止' }}
          </el-button>

          <el-input v-model="queryParams.keyword" placeholder="搜原素材..." clearable @keyup.enter="handleQuery" style="width: 200px" />
          <el-button type="primary" @click="handleQuery">刷新大板</el-button>
        </div>
      </div>
    </el-header>

    <el-main v-loading="loading">
      <div v-for="post in postList" :key="post.scraperId" class="post-group">

        <!-- 1. 原素材参照行 (灰色背景) -->
        <div class="table-row original-row">
          <div class="cell-version-label">
            <span class="ref-tag">原贴参考</span>
            <el-button type="success" size="small" icon="CirclePlus" @click="createNewVersion(post)">建新版</el-button>
            <el-button type="warning" size="small" icon="MagicStick" :loading="restyleStatus[post.scraperId]?.loading" @click="handleAutoRestyle(post)">一键AI复刻</el-button>
            <div v-if="restyleStatus[post.scraperId]?.msg" class="status-msg">{{ restyleStatus[post.scraperId].msg }}</div>
          </div>
          <div class="cell-text">
            <div class="original-title line-clamp-1" :title="post.title">{{ post.title || '无标题' }}</div>
            <div class="original-body line-clamp-2" :title="post.content">{{ post.content || '无正文' }}</div>
            <div class="cell-actions">
              <el-button size="small" type="primary" plain @click="copy(post.title + '\n' + post.content)">复制文案</el-button>
              <el-button size="small" link @click="openLink(post.sourceUrl)">去原文看</el-button>
            </div>
          </div>

          <div class="media-column-wrapper">
              <!-- 原素材图片 -->
              <div v-for="(img, idx) in getOriginalImgList(post)" :key="idx" class="media-cell img-cell original-img-cell">
                <div class="img-container" @click="handlePreviewImg(img, getOriginalImgList(post))">
                  <el-image :src="img" fit="cover" class="img-thumb" />
                  <div class="img-delete-btn" @click.stop="removeOriginalImage(post, idx)">
                    <el-icon><Delete /></el-icon>
                  </div>
                </div>
                <div class="img-label">原图 {{ idx+1 }}</div>
              </div>
              <!-- 原素材视频封面 (如果是视频帖，移至末尾) -->
              <div v-if="getOriginalVideos(post).length > 0" class="media-cell video-cell">
                <div class="video-placeholder" @click="playOriginalVideo(post)">
                  <el-icon><VideoPlay /></el-icon><span>原视频</span>
                </div>
              </div>
          </div>
        </div>

        <!-- 2. 复刻版本行 (每一个 Version 是一整包) -->
        <div v-for="(ver, vidx) in getVersions(post)" :key="vidx" class="table-row version-row">
          <div class="cell-version-label">
            <span class="ver-badge">Ver.{{ vidx+1 }}</span>
            <el-tag :type="ver.isUsed ? 'success' : 'info'" size="small">{{ ver.isUsed ? '已发' : '未使用' }}</el-tag>
            <el-button link type="danger" icon="Delete" @click="removeVersion(post, vidx)"></el-button>
          </div>

          <div class="cell-text">
            <div class="ver-title-row" @click="editVerProp(post, vidx, 'title')">
              <span class="v-title line-clamp-1">{{ ver.title }}</span>
              <div class="text-row-actions">
                <el-button size="small" icon="MagicStick" circle type="primary" plain title="AI重写文案(全文)" @click.stop="handleIndividualRestyle(post, 'text', vidx)"></el-button>
                <el-button size="small" icon="CopyDocument" circle @click.stop="copy(ver.title)"></el-button>
              </div>
            </div>
            <div class="ver-content-row" @click="editVerProp(post, vidx, 'content')">
               <span class="v-body line-clamp-2">{{ ver.content }}</span>
               <el-button size="small" icon="CopyDocument" circle @click.stop="copy(ver.content)"></el-button>
            </div>
          </div>

          <!-- 复刻全流展示 (视频 + 图片一对一) -->
          <div class="media-column-wrapper">
            <!-- 先遍历：根据原图数量决定格子数 (实现 1:1 图片对照优先) -->
            <div v-for="(_, iidx) in getOriginalImgList(post)" :key="iidx" class="media-cell img-cell">
               <!-- 核心逻辑：尝试获取该版本下对应索引的图片数据 -->
               <div v-if="!ver.images[iidx] || !ver.images[iidx].url" class="empty-restyle-placeholder">
                 <div class="placeholder-content" @click="editImageRestyle(post, vidx, iidx)">
                   <el-icon><Picture /></el-icon><span>未复刻</span>
                 </div>
                 <div class="placeholder-overlay">
                   <el-button type="primary" size="small" icon="MagicStick" circle title="独立AI复刻" @click.stop="handleIndividualRestyle(post, 'image', vidx, iidx)"></el-button>
                   <el-button type="warning" size="small" icon="Edit" circle title="手动登记地址" @click.stop="editImageRestyle(post, vidx, iidx)"></el-button>
                 </div>
               </div>
               <div v-else class="restyle-img-box" @click="handlePreviewImg(ver.images[iidx].url, ver.images.map(i => i.url))">
                  <el-image :src="ver.images[iidx].url" fit="cover" class="img-thumb ver-border" />
                  <div class="restyle-overlay">
                    <el-button size="small" link type="primary" icon="MagicStick" title="重新AI复刻" @click.stop="handleIndividualRestyle(post, 'image', vidx, iidx)"></el-button>
                    <el-button v-if="ver.images[iidx].prevUrl" size="small" link type="info" icon="RefreshLeft" title="撤回上一步" @click.stop="handleUndoRestyle(post, vidx, 'image', iidx)"></el-button>
                    <el-button size="small" link type="warning" icon="Edit" @click.stop="editImageRestyle(post, vidx, iidx)"></el-button>
                    <el-button size="small" link type="success" icon="CopyDocument" @click.stop="copy(ver.images[iidx].url)"></el-button>
                  </div>
                </div>
               <div class="img-label">对应原图 {{ iidx+1 }}</div>
            </div>

            <!-- 最后展示：复刻视频成果 -->
             <div class="media-cell video-cell restyle-video">
                <div v-if="!ver.videoUrl" class="empty-restyle-placeholder">
                  <div class="placeholder-content" @click="editVersionVideo(post, vidx)">
                    <el-icon><Film /></el-icon><span>上传视频</span>
                  </div>
                  <div class="placeholder-overlay">
                    <el-button type="primary" size="small" icon="MagicStick" circle title="独立AI复刻视频" @click.stop="handleIndividualRestyle(post, 'video', vidx)"></el-button>
                    <el-button type="warning" size="small" icon="Edit" circle title="手动登记地址" @click.stop="editVersionVideo(post, vidx)"></el-button>
                  </div>
                </div>
               <div v-else class="preview-video-box">
                 <video :src="ver.videoUrl" class="v-thumb-player" muted></video>
                  <div class="video-actions">
                    <el-button size="small" type="primary" plain icon="MagicStick" circle @click="handleIndividualRestyle(post, 'video', vidx)"></el-button>
                    <el-button v-if="ver.prevVideoUrl" size="small" type="info" plain icon="RefreshLeft" circle title="撤回上一步" @click="handleUndoRestyle(post, vidx, 'video')"></el-button>
                    <el-button size="small" type="warning" plain icon="Refresh" circle @click="editVersionVideo(post, vidx)"></el-button>
                    <el-button size="small" type="success" plain icon="Download" circle @click="copy(ver.videoUrl)"></el-button>
                  </div>
                 <div class="v-label">复刻成果视频</div>
               </div>
            </div>
          </div>
        </div>

        <el-divider v-if="postList.indexOf(post) !== postList.length - 1" />
      </div>

      <div class="pagination-box">
        <el-pagination v-model:current-page="queryParams.pageNum" :page-size="queryParams.pageSize" layout="total, prev, pager, next" :total="total" @current-change="handleQuery" />
      </div>
    </el-main>

    <!-- 文案快捷编辑 -->
    <el-dialog v-model="textEdit.visible" title="极速修正文案" width="500px">
      <el-form label-position="top">
        <el-form-item :label="textEdit.prop==='title'?'当前版标题':'当前版正文'">
          <el-input v-model="textEdit.value" :type="textEdit.prop==='title'?'text':'textarea'" :rows="8" />
        </el-form-item>
        <el-form-item label="发布状态">
          <el-switch v-model="textEdit.isUsed" active-text="已发" inactive-text="未发" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="textEdit.visible = false">取消</el-button>
        <el-button type="primary" @click="saveTextEdit">提交更新</el-button>
      </template>
    </el-dialog>

    <!-- 图片/视频 URL 登记对话框 -->
    <el-dialog v-model="urlDialog.visible" :title="urlDialog.title" width="500px">
      <el-input v-model="urlDialog.url" placeholder="请贴入 AI 复刻后的新 URL 地址..." type="textarea" :rows="3" />
      <template #footer>
        <el-button @click="urlDialog.visible = false">放弃</el-button>
        <el-button type="primary" @click="saveUrlEdit">确认入库</el-button>
      </template>
    </el-dialog>

    <!-- 环境选择对话框 (增强版：支持自定义提示词与参考源) -->
    <el-dialog v-model="envDialog.visible" width="550px" class="glass-dialog custom-restyle-dialog">
      <template #header>
        <div class="dialog-header-custom" style="display: flex; align-items: center; gap: 10px;">
          <span style="font-weight: 800; font-size: 16px;">
            <span v-if="envDialog.mode === 'full'">🔮 全案自动化复刻方案</span>
            <span v-else>✨ 单项素材 AI 优化</span>
          </span>
          <el-button size="small" circle icon="Refresh" @click="refreshOpenList" :loading="loadingList"></el-button>
        </div>
      </template>

      <!-- 1. 环境选择区 -->
      <div class="dialog-sub-title">1. 选择活跃执行环境 (Chrome 调试端口)</div>
      <div v-loading="loadingList" class="env-selection-list">
        <div v-for="win in openWindows" :key="win.chromePort"
             class="env-item" :class="{ active: envDialog.selectedPort === win.chromePort }"
             @click="envDialog.selectedPort = win.chromePort">
          <el-icon class="env-icon"><Monitor /></el-icon>
          <div class="env-info">
            <div class="env-name">{{ win.name || '未命名环境' }}</div>
            <div class="env-port">调试端口: {{ win.chromePort }}</div>
          </div>
          <el-radio v-model="envDialog.selectedPort" :label="win.chromePort">{{''}}</el-radio>
        </div>
        <el-empty v-if="!loadingList && openWindows.length === 0" description="暂无活跃浏览器环境，请先启动环境" />
        </div>

        <!-- 2. AI 创作偏好区 (还原并修复结构) -->
        <div class="ai-config-section" style="margin-top: 20px;">
          <div class="dialog-sub-title">2. AI 创作微调 (可选提示词)</div>
          <el-input
            v-model="envDialog.customPrompt"
            type="textarea"
            :rows="3"
            placeholder="[可选] 在这里输入补充要求（例如：画面稍微暗一些、添加复古质感、正文多加点符号等）"
            style="margin-bottom: 12px;"
          />

          <!-- 图片参考源选择 (仅单图模式) -->
          <div v-if="envDialog.mode === 'image'" class="source-selection-row" style="flex-wrap: wrap; gap: 8px; display: flex; align-items: center;">
              <span class="label">创作模式:</span>
              <el-radio-group v-model="envDialog.sourceMode" size="small" fill="#f59e0b">
                <el-radio-button label="original">原图 (智能融合)</el-radio-button>
                <el-radio-button label="restyled">复刻图 (二次加工)</el-radio-button>
                <el-radio-button label="original_pure">原图 (纯文生图)</el-radio-button>
                <el-radio-button label="restyled_pure">复刻图 (纯文生图)</el-radio-button>
              </el-radio-group>
              <el-tooltip placement="top">
                <template #content>
                  <b>智能融合</b>: 系统会自动分析原图特征，结合文案生成深度复刻提示词。<br/>
                  <b>纯文生图</b>: 跳过系统分析，仅根据您输入的自定义提示词进行生图（需填写提示词）。
                </template>
                <el-icon style="margin-left:8px; cursor:help; color:#94a3b8;"><QuestionFilled /></el-icon>
              </el-tooltip>
          </div>
        </div>

        <!-- 3. 素材库参考图选择 (新增) -->
        <div class="material-selection-section" style="margin-top: 20px;">
          <div class="dialog-sub-title" style="display: flex; justify-content: space-between; align-items: center;">
            <span>3. 选择素材库外部参考图 (可选)</span>
            <el-button link type="primary" size="small" @click="fetchMaterials">刷新素材库</el-button>
          </div>
          <div v-loading="loadingMaterials" class="material-selection-grid">
            <div v-for="item in materialList" :key="item.materialId"
                 class="material-select-item"
                 :class="{ selected: isMaterialSelected(item) }"
                 @click="toggleMaterial(item)">
              <el-image :src="item.materialUrl" fit="cover" class="mini-material-img" />
              <div v-if="isMaterialSelected(item)" class="selection-order">
                {{ getMaterialOrder(item) }}
              </div>
              <div class="selection-check">
                <el-icon v-if="isMaterialSelected(item)"><Check /></el-icon>
              </div>
            </div>
            <el-empty v-if="!loadingMaterials && materialList.length === 0" :image-size="40" description="素材库暂无素材" />
          </div>
          <div v-if="envDialog.selectedMaterials.length > 0" class="selection-summary">
            已选择 {{ envDialog.selectedMaterials.length }} 张素材，将按序号顺序发送给 AI。
            <el-button link type="danger" size="small" @click="envDialog.selectedMaterials = []">清空选择</el-button>
          </div>
        </div>

      <template #footer>
        <el-button @click="envDialog.visible = false">取消</el-button>
        <el-button type="warning" :disabled="!envDialog.selectedPort" @click="confirmRestyle">启动 AI 复刻程序</el-button>
      </template>
    </el-dialog>

    <!-- 全局图片/视频统一预览器 (解决闪屏和列表联动) -->
    <el-image-viewer
      v-if="pv.visible"
      :url-list="pv.list"
      :initial-index="pv.index"
      teleported
      @close="closePreview"
    />

  </el-container>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { Film, VideoPlay, Picture, Delete, CopyDocument, Refresh, CirclePlus, Download, MagicStick, Monitor, QuestionFilled, RefreshLeft, Check, VideoCamera, Mute } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import axios from 'axios';
import { useScraperTask } from '../hooks/useScraperTask';

const BACKEND_URL = 'http://localhost:8080/business';
// const BACKEND_URL = 'http://admin.ruoyivueplus.wulynk.com:8700/prod-api/business'
const loading = ref(false);
const total = ref(0);
const postList = ref([]);
const queryParams = reactive({ pageNum: 1, pageSize: 12, platform: null, keyword: '' });

// 素材库数据
const materialList = ref([]);
const loadingMaterials = ref(false);

// 复刻状态追踪
const restyleStatus = reactive({});

// 监听 main 进程发来的日志
if (window.electronAPI && window.electronAPI.on) {
  window.electronAPI.on('scraper-log', (data) => {
    if (data.scraperId) {
       restyleStatus[data.scraperId] = { ...restyleStatus[data.scraperId], msg: data.msg };
    }
  });
  window.electronAPI.on('video-reproduce-log', (data) => {
      // 在这里可以用一个小弹窗或者顶部 Notification 来提示自动化状态，或者写到控制台
      console.log(`[VideoPoller] ${data.msg}`);
      if (data.type === 'error') {
          ElMessage.error(data.msg);
      } else if (data.type === 'success') {
          ElMessage.success(data.msg);
      }
  });
}

// 轮询器状态
const pollerStatus = reactive({ isPolling: false });

const getPollerStatus = async () => {
    if (window.electronAPI) {
        const res = await window.electronAPI.invoke("video-reproduce-status");
        if (res) pollerStatus.isPolling = res.isPolling;
    }
};

const togglePoller = async () => {
    // 弹窗选择端口（可以默认取 active environment）
    if (!pollerStatus.isPolling) {
        if (!openWindows.value || openWindows.value.length === 0) {
            refreshOpenList();
            ElMessage.warning('正在拉取活跃浏览器环境，请稍后再试或先启动环境。');
            return;
        }
        // 简单处理：取第一个端口。如果多端口最好开个 Dialog
        const port = openWindows.value[0].chromePort;
        const res = await window.electronAPI.invoke("video-reproduce-start", { port });
        if (res && res.success) {
            pollerStatus.isPolling = true;
            ElMessage.success(`已开启云端队列轮询，绑定端口: ${port}`);
        } else {
            ElMessage.error('开启轮询失败: ' + (res ? res.error : ''));
        }
    } else {
        const res = await window.electronAPI.invoke("video-reproduce-stop");
        if (res && res.success) {
            pollerStatus.isPolling = false;
            ElMessage.info('已停止云端队列轮询');
        } else {
            ElMessage.error('停止轮询失败 ' + (res ? res.error : ''));
        }
    }
};

const { openWindows, loadingList, refreshOpenList } = useScraperTask();

// 对话框数据栈
const textEdit = reactive({ visible: false, post: null, vidx: 0, prop: '', value: '', isUsed: false });
const urlDialog = reactive({ visible: false, post: null, vidx: 0, type: '', iidx: 0, url: '', title: '' });
const envDialog = reactive({
  visible: false, post: null, selectedPort: null, mode: '', vidx: 0, iidx: 0,
  customPrompt: '', sourceMode: 'original', selectedMaterials: []
});
const pv = reactive({ visible: false, list: [], index: 0 });

const fetchList = async () => {
  loading.value = true;
  try {
    const res = await axios.get(`${BACKEND_URL}/scraper/list`, { params: queryParams });
    if (res.data.code === 200) {
      postList.value = res.data.data.records;
      total.value = res.data.data.total;
    }
  } catch (e) { ElMessage.error('加载失败'); }
  finally { loading.value = false; }
};

const fetchMaterials = async () => {
  loadingMaterials.value = true;
  try {
    const res = await axios.get(`${BACKEND_URL}/material/list`, { params: { pageSize: 100, fileType: '0' } });
    if (res.data.code === 200) {
      materialList.value = res.data.rows;
    }
  } catch (e) { ElMessage.error('获取素材库失败'); }
  finally { loadingMaterials.value = false; }
};

const isMaterialSelected = (item) => envDialog.selectedMaterials.includes(item.materialUrl);
const getMaterialOrder = (item) => envDialog.selectedMaterials.indexOf(item.materialUrl) + 1;
const toggleMaterial = (item) => {
  const index = envDialog.selectedMaterials.indexOf(item.materialUrl);
  if (index > -1) {
    envDialog.selectedMaterials.splice(index, 1);
  } else {
    envDialog.selectedMaterials.push(item.materialUrl);
  }
};

const handleQuery = () => fetchList();

const getVersions = (p) => { try { return JSON.parse(p.restyleInfo || '[]'); } catch (e) { return []; } };
const getOriginalImgList = (p) => { try { return JSON.parse(p.images || '[]').map(i => i.urlDefault || i); } catch (e) { return []; } };
const getOriginalVideos = (p) => { try { return JSON.parse(p.videos || '[]'); } catch (e) { return []; } };

const handlePreviewImg = (url, list) => {
  if (!url) return;
  pv.list = list.filter(u => u && u.startsWith('http')).map(u => u);
  pv.index = pv.list.indexOf(url);
  if (pv.index === -1) {
    pv.list = [url];
    pv.index = 0;
  }
  pv.visible = true;
};
const closePreview = () => { pv.visible = false; };

const removeOriginalImage = (post, idx) => {
  ElMessageBox.confirm('确定从库中移除这张原图吗？这会同时影响后续复刻图的顺序映射。').then(async () => {
    try {
      // 1. 更新原图列表
      let images = JSON.parse(post.images || '[]');
      images.splice(idx, 1);
      const imagesJson = JSON.stringify(images);

      // 2. 关键：同步修正已存在的复刻版本索引
      let versions = getVersions(post);
      versions.forEach(ver => {
        if (ver.images) {
          // 删除对应原图索引的记录，并让后续索引减一
          ver.images = ver.images.filter(img => img.originalIndex !== idx);
          ver.images.forEach(img => {
            if (img.originalIndex > idx) img.originalIndex -= 1;
          });
        }
      });
      const restyleInfoJson = JSON.stringify(versions);

      // 3. 多路请求同步
      await axios.put(`${BACKEND_URL}/scraper/updateMedia`, {
        scraperId: post.scraperId,
        images: imagesJson,
        videos: post.videos
      });
      await axios.put(`${BACKEND_URL}/scraper/updateRestyle`, {
        scraperId: post.scraperId,
        restyleInfo: restyleInfoJson
      });

      // 4. 更新前端视图数据
      post.images = imagesJson;
      post.restyleInfo = restyleInfoJson;
      ElMessage.success('原图片已库中移除');
    } catch (e) {
      ElMessage.error('删除同步失败: ' + e.message);
    }
  });
};
const createNewVersion = async (post) => {
  const versions = getVersions(post);
  const imgList = getOriginalImgList(post);
  versions.push({
    title: post.title,
    content: post.content,
    isUsed: false,
    videoUrl: '', // 【新字段：复刻版视频】
    images: imgList.map((_, i) => ({ originalIndex: i, url: '' })),
    createTime: new Date().toISOString()
  });
  updateDB(post, versions);
};

const handleAutoRestyle = async (post) => {
  envDialog.post = post;
  envDialog.selectedPort = null;
  envDialog.mode = 'full';
  envDialog.customPrompt = ''; // 重置
  envDialog.sourceMode = 'original';
  envDialog.selectedMaterials = []; // 重置
  envDialog.visible = true;
  refreshOpenList();
  fetchMaterials();
};

const handleIndividualRestyle = async (post, mode, vidx = 0, iidx = 0) => {
  envDialog.post = post;
  envDialog.selectedPort = null;
  envDialog.mode = mode; // 'text' | 'image' | 'video'
  envDialog.vidx = vidx;
  envDialog.iidx = iidx;
  envDialog.customPrompt = ''; // 重置
  envDialog.sourceMode = 'original';
  envDialog.selectedMaterials = []; // 重置
  envDialog.visible = true;
  refreshOpenList();
  fetchMaterials();
};

const handleUndoRestyle = async (post, vidx, type, iidx = 0) => {
    try {
        const postData = JSON.parse(JSON.stringify(post));
        const result = await window.electronAPI.invoke('run-gemini-undo', { post: postData, vidx, type, iidx });
        if (result.success) {
            post.restyleInfo = JSON.stringify(result.versions);
            ElMessage.success('成功撤回至上一步素材');
        } else {
            ElMessage.error(result.error);
        }
    } catch (e) {
        ElMessage.error('撤回失败: ' + e.message);
    }
};

const confirmRestyle = async () => {
  const post = envDialog.post;
  const port = envDialog.selectedPort;
  const mode = envDialog.mode;
  const vidx = envDialog.vidx;
  const iidx = envDialog.iidx;
  envDialog.visible = false;

  // 1. 获取所有需要的提示词模板
  try {
    restyleStatus[post.scraperId] = { loading: true, msg: '获取模板中...' };
    const res = await axios.get('http://localhost:8080/business/promptTemplate/list', { params: { pageSize: 100 } });
    // const res = await axios.get('http://admin.ruoyivueplus.wulynk.com:8700/prod-api/business/promptTemplate/list', { params: { pageSize: 100 } });

    const templateList = res.data.rows || res.data.data;
    const findTemplate = (type) => templateList.find(t => t.templateType === type)?.template;

    const templates = {
        analyze: findTemplate(4),
        restyle: findTemplate(5),
        rewrite: findTemplate(6),
        video: findTemplate(7)
    };

    if (!templates.analyze || !templates.restyle || !templates.rewrite || !templates.video) {
        throw new Error('部分提示词模板未配置');
    }

    // 2. 根据模式执行对应的 IPC 处理器
    let result;
    const postData = JSON.parse(JSON.stringify(post));
    const templatesData = JSON.parse(JSON.stringify(templates));
    const customPrompt = envDialog.customPrompt;
    const extraMaterials = [...envDialog.selectedMaterials]; // 展开 Proxy 为普通数组

    if (mode === 'full') {
        result = await window.electronAPI.invoke('run-gemini-restyle', {
            post: postData,
            templates: templatesData,
            port,
            customPrompt: customPrompt,
            extraMaterials: extraMaterials // 传递普通数组
        });
    } else if (mode === 'text') {
        result = await window.electronAPI.invoke('run-gemini-rewrite-text', { post: postData, templates: templatesData, port });
    } else if (mode === 'image') {
        // 构造参考源 URL
        let sourceUrl = '';
        if (envDialog.sourceMode.includes('restyled')) {
            const versions = getVersions(post);
            sourceUrl = versions[vidx]?.images[iidx]?.url || '';
            if (!sourceUrl) {
                ElMessage.warning('当前位置尚无已复刻图片成果，将自动切换回原图参考');
            }
        }

        result = await window.electronAPI.invoke('run-gemini-restyle-image', {
            post: postData, vidx, iidx, templates: templatesData, port,
            customPrompt: customPrompt,
            sourceUrl: sourceUrl,
            sourceMode: envDialog.sourceMode, // 新增传递模式
            extraMaterials: extraMaterials // 传递普通数组
        });
    } else if (mode === 'video') {
        result = await window.electronAPI.invoke('run-gemini-restyle-video', {
            post: postData, vidx, templates: templatesData, port,
            customPrompt: customPrompt,
            extraMaterials: extraMaterials // 传递普通数组
        });
    }

    if (result.success) {
        ElMessage.success('操作成功！');
        await updateDB(post, result.versions);
        // 更新本地 postList 对应项
        const target = postList.value.find(p => p.scraperId === post.scraperId);
        if (target) target.restyleInfo = JSON.stringify(result.versions);
    } else {
        ElMessage.error('转换失败: ' + result.error);
    }
  } catch (e) {
    ElMessage.error('流程启动异常: ' + e.message);
  } finally {
    restyleStatus[post.scraperId].loading = false;
    setTimeout(() => { restyleStatus[post.scraperId].msg = ''; }, 3000);
  }
};

const removeVersion = (post, vidx) => {
  ElMessageBox.confirm('确定废弃这个全案版本吗？').then(() => {
    const versions = getVersions(post);
    versions.splice(vidx, 1);
    updateDB(post, versions);
  });
};

const editVerProp = (post, vidx, prop) => {
  const versions = getVersions(post);
  textEdit.post = post;
  textEdit.vidx = vidx;
  textEdit.prop = prop;
  textEdit.value = versions[vidx][prop];
  textEdit.isUsed = versions[vidx].isUsed;
  textEdit.visible = true;
};

const saveTextEdit = () => {
  const versions = getVersions(textEdit.post);
  versions[textEdit.vidx][textEdit.prop] = textEdit.value;
  versions[textEdit.vidx].isUsed = textEdit.isUsed;
  updateDB(textEdit.post, versions, () => { textEdit.visible = false; });
};

const editImageRestyle = (post, vidx, iidx) => {
  const versions = getVersions(post);
  urlDialog.post = post;
  urlDialog.vidx = vidx;
  urlDialog.iidx = iidx;
  urlDialog.type = 'image';
  urlDialog.url = versions[vidx].images[iidx].url;
  urlDialog.title = '修正 第 '+(iidx+1)+' 张图的复刻结果';
  urlDialog.visible = true;
};

const editVersionVideo = (post, vidx) => {
  const versions = getVersions(post);
  urlDialog.post = post;
  urlDialog.vidx = vidx;
  urlDialog.type = 'video';
  urlDialog.url = versions[vidx].videoUrl || '';
  urlDialog.title = '登记/修正 Version '+(vidx+1)+' 的复刻版视频';
  urlDialog.visible = true;
};

const saveUrlEdit = () => {
  const versions = getVersions(urlDialog.post);
  if (urlDialog.type === 'video') {
    versions[urlDialog.vidx].videoUrl = urlDialog.url;
  } else {
    if (!versions[urlDialog.vidx].images[urlDialog.iidx]) {
      versions[urlDialog.vidx].images[urlDialog.iidx] = { originalIndex: urlDialog.iidx };
    }
    versions[urlDialog.vidx].images[urlDialog.iidx].url = urlDialog.url;
  }
  updateDB(urlDialog.post, versions, () => { urlDialog.visible = false; });
};

const updateDB = async (post, versions, callback) => {
  const jsonStr = JSON.stringify(versions);
  try {
    await axios.put(`${BACKEND_URL}/scraper/updateRestyle`, { scraperId: post.scraperId, restyleInfo: jsonStr });
    post.restyleInfo = jsonStr;
    if (callback) callback();
    ElMessage.success('库数据已同步');
  } catch (e) { ElMessage.error('数据库更新异常'); }
};

const copy = (t) => { navigator.clipboard.writeText(t); ElMessage.success('已复制'); };
const openLink = (u) => window.open(u);
const playOriginalVideo = (p) => { const v = getOriginalVideos(p); if (v.length > 0) window.open(v[0].url || v[0].backupUrl); };

onMounted(() => {
  fetchList();
  getPollerStatus();
});
</script>

<style scoped>
.power-grid-container { height: 100vh; background: #fcfdfe; color: #334155; font-size: 13px; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
.grid-header { padding: 18px 30px; border-bottom: 1px solid #e2e8f0; background: #fff; }
.header-content { display: flex; justify-content: space-between; align-items: center; }
.title-group { display: flex; align-items: center; gap: 15px; }
.logo-icon { font-size: 30px; color: #f59e0b; padding: 10px; background: rgba(245, 158, 11, 0.08); border-radius: 14px; }
.text h2 { margin: 0; font-size: 20px; font-weight: 800; color: #1e293b; letter-spacing: -0.5px; }
.text p { margin: 2px 0 0; font-size: 12px; color: #64748b; }

.status-msg { font-size: 11px; color: #f59e0b; margin-top: 5px; font-weight: bold; text-align: center; max-width: 80px; word-break: break-all; }

.post-group { padding: 10px 25px; }

/* 核心：行布局 - 模块化展示 */
.table-row { display: flex; border: 1px solid transparent; min-height: 140px; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); border-radius: 12px; margin-bottom: 2px; }
.table-row:hover { background: #fff; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05); }

/* 侧边版本标识筒 */
.cell-version-label { width: 90px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: #f8fafc; border-radius: 12px 0 0 12px; border-right: 1px dashed #e2e8f0; }
.ref-tag { font-weight: 800; color: #94a3b8; font-size: 11px; letter-spacing: 0.5px; }
.ver-badge { font-weight: 900; color: #f59e0b; font-size: 16px; font-family: 'Arial Black', sans-serif; }

/* 文本编辑器栏 */
.cell-text { width: 380px; padding: 20px; display: flex; flex-direction: column; justify-content: space-between; border-right: 1px dashed #e2e8f0; }
.original-title { font-weight: 700; color: #334155; margin-bottom: 6px; font-size: 14px; }
.original-body { font-size: 12px; color: #64748b; line-height: 1.6; }

.ver-title-row, .ver-content-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; cursor: pointer; padding: 6px 8px; border-radius: 8px; border: 1px solid transparent; position: relative; }
.ver-title-row:hover, .ver-content-row:hover { background: #f1f5f9; border-color: #cbd5e1; }
.v-title { font-weight: 700; color: #1e293b; flex: 1; }
.text-row-actions { display: flex; gap: 6px; flex-shrink: 0; }
.v-body { font-size: 12px; color: #475569; line-height: 1.6; }

.cell-actions { margin-top: 12px; display: flex; gap: 10px; }

/* 图片与视频综合列包裹器 */
.media-column-wrapper { flex: 1; display: flex; overflow-x: auto; padding: 15px; gap: 20px; }
.media-cell { width: 110px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; }

.img-thumb, .v-thumb-player, .video-placeholder, .empty-video-box, .empty-restyle-placeholder { width: 100px; height: 100px; border-radius: 10px; transition: transform 0.2s; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
.img-thumb:hover { transform: scale(1.05); }

/* 原素材图容器与删除层 */
.img-container { position: relative; width: 100px; height: 100px; cursor: pointer; }
.img-delete-layer {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(239, 68, 68, 0.6); border-radius: 10px;
  display: flex; justify-content: center; align-items: center;
  color: #fff; font-size: 24px; opacity: 0; transition: all 0.3s;
}
.img-container:hover .img-delete-layer { opacity: 1; backdrop-filter: blur(2px); }
.img-container:hover .img-thumb { filter: grayscale(0.5); }

/* 高级感点缀：复刻成功的边框 */
.ver-border { border: 2px solid #f59e0b; }

.img-label, .v-label { font-size: 11px; color: #94a3b8; margin-top: 10px; font-weight: 600; text-align: center; }

/* 视频格子专用 - 琥珀金属感 */
.video-cell { border-left: 2px solid #f59e0b; padding-left: 10px !important; width: 130px; }
.video-placeholder { background: #1e293b; color: #fff; display: flex; flex-direction: column; justify-content: center; align-items: center; cursor: pointer; gap: 5px; }
.empty-video-box { background: #fff; border: 2px dashed #f59e0b; color: #f59e0b; display: flex; flex-direction: column; justify-content: center; align-items: center; cursor: pointer; font-weight: bold; }

.preview-video-box { position: relative; width: 100px; height: 100px; }
.video-actions {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(0,0,0,0.5); border-radius: 10px; display: flex; justify-content: center; align-items: center; gap: 10px;
  opacity: 0; transition: opacity 0.3s;
}
.preview-video-box:hover .video-actions { opacity: 1; }

.empty-restyle-placeholder {
  position: relative;
  background: #f8fafc; border: 2px dashed #cbd5e1;
  display: flex; flex-direction: column; justify-content: center; align-items: center;
  color: #94a3b8; cursor: pointer; gap: 5px;
}
.placeholder-content { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; }
.placeholder-overlay {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(255,255,255,0.7); backdrop-filter: blur(2px);
  display: flex; justify-content: center; align-items: center; gap: 10px;
  opacity: 0; transition: opacity 0.3s; border-radius: 10px;
}
.empty-restyle-placeholder:hover .placeholder-overlay { opacity: 1; }
.empty-restyle-placeholder:hover { border-color: #f59e0b; color: #f59e0b; background: #fff; }

.restyle-img-box { position: relative; width: 100px; height: 100px; }
.restyle-overlay {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(255,255,255,0.8); display: flex; justify-content: center; align-items: center; gap: 10px;
  opacity: 0; transition: opacity 0.3s; border-radius: 10px;
}
.restyle-img-box:hover .restyle-overlay { opacity: 1; }

.pagination-box { display: flex; justify-content: center; padding: 40px 0; }
.line-clamp-1 { display: -webkit-box; -webkit-line-clamp: 1; line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
.line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

/* 帖子行顶部分隔符 */
.original-row { background: #f8fafc; border-top: 4px solid #94a3b8; border-bottom: 2px solid #e2e8f0; margin-top: 15px; }
/* 复刻版侧边金带 */
.version-row { border-left: 6px solid #f59e0b; background: #fff; margin-top: 6px; }


/* 环境选择样式 */
.env-selection-list { display: flex; flex-direction: column; gap: 10px; max-height: 200px; overflow-y: auto; padding: 10px; border-bottom: 1px dashed #e2e8f0; }

.dialog-sub-title { font-size: 12px; font-weight: 800; color: #64748b; margin: 10px 0 10px 10px; text-transform: uppercase; letter-spacing: 0.5px; }

.source-selection-row { display: flex; align-items: center; gap: 12px; padding: 0 10px; }
.source-selection-row .label { font-size: 13px; font-weight: 700; color: #475569; }

.env-item {
  display: flex; align-items: center; gap: 15px; padding: 12px; border-radius: 12px;
  background: #f8fafc; border: 2px solid transparent; cursor: pointer; transition: all 0.2s;
}
.env-item:hover { background: #f1f5f9; border-color: #e2e8f0; }
.env-item.active { background: #fffbeb; border-color: #f59e0b; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.1); }
.env-icon { font-size: 24px; color: #f59e0b; background: #fff; padding: 8px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
.env-info { flex: 1; }
.env-name { font-weight: 700; color: #1e293b; font-size: 14px; }
.env-port { font-size: 12px; color: #64748b; margin-top: 2px; }

.material-selection-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  max-height: 240px;
  overflow-y: auto;
  padding: 10px;
  background: #f8fafc;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}
.material-select-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.2s;
}
.material-select-item:hover { transform: scale(1.05); }
.material-select-item.selected { border-color: #f59e0b; }
.mini-material-img { width: 100%; height: 100%; }
.selection-order {
  position: absolute;
  top: 5px;
  left: 5px;
  background: #f59e0b;
  color: #fff;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 11px;
  font-weight: 800;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}
.selection-check {
  position: absolute;
  bottom: 0px;
  right: 0px;
  background: rgba(245, 158, 11, 0.8);
  color: #fff;
  padding: 2px;
  border-radius: 4px 0 0 0;
  display: none;
}
.material-select-item.selected .selection-check { display: flex; }
.selection-summary {
  margin-top: 10px;
  font-size: 12px;
  color: #64748b;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-left: 10px;
}

:deep(.el-divider--horizontal) { margin: 20px 0; opacity: 0.5; }
</style>
