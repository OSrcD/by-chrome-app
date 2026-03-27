import { ref, reactive } from 'vue';
import { ElMessage, ElNotification } from 'element-plus';

/**
 * 平台字典映射
 */
const PLATFORM_MAP = {
  '0': '小红书',
  '1': '抖音',
  '2': '快手',
  '3': '闲鱼',
  '4': '视频号',
  '5': 'B站',
  '6': '其他'
};

/**
 * 通用采集任务逻辑 Hook (支持多环境并发管理)
 */
export function useScraperTask() {
  const openWindows = ref([]);
  const loadingList = ref(false);
  const scrapeLoading = ref(null);
  const showProgress = ref(false);
  
  // 日志池：以 port 为键存储日志数组 { '9223': [], '9224': [] }
  const taskLogsPool = reactive({});
  // 状态池：每个环境的任务状态 { '9223': 'running', '9224': 'paused' }
  const taskStatusPool = reactive({});

  // 1. 刷新环境列表
  const refreshOpenList = async () => {
    loadingList.value = true;
    try {
      const list = await window.electronAPI.invoke('get-open-windows');
      openWindows.value = list;
    } catch (e) {
      ElMessage.error("获取活跃环境失败");
    } finally {
      loadingList.value = false;
    }
  };

  // 2. 日志管理：精准推送到指定端口的日志数组
  const addLog = (port, msg, type = 'info') => {
    if (!taskLogsPool[port]) taskLogsPool[port] = [];
    taskLogsPool[port].unshift({
      time: new Date().toLocaleTimeString(),
      msg,
      type
    });
  };

  // 3. 执行任务调度核心
  const executeScraperTask = async (port, platform, keyword, filters) => {
    if (!keyword) return ElMessage.warning("关键词任务不能为空");
    
    // 初始化该端口的日志与状态
    taskLogsPool[port] = [];
    taskStatusPool[port] = 'running';
    scrapeLoading.value = port; // 标记正在运行
    
    const platformName = PLATFORM_MAP[platform] || platform;
    addLog(port, `🚀 采集任务准备启动... [平台: ${platformName} | 关键词: ${keyword} ]`, 'primary');
    
    try {
      const res = await fetch(`http://localhost:3000/window/scrapeBySearch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port, platform, keyword, filters })
      });
      
      const result = await res.json();
      if (result.code === 200) {
        addLog(port, "任务成功结束: " + (result.data?.msg || result.msg), 'success');
        taskStatusPool[port] = 'stopped';
        ElNotification({
          title: `端口 ${port} 采集报表`,
          message: result.data?.msg || result.msg,
          type: 'success',
          duration: 0
        });
      } else {
        addLog(port, `业务响应报错: ${result.msg}`, 'error');
        taskStatusPool[port] = 'stopped';
      }
    } catch (e) {
      addLog(port, `网络或服务级异常: ${e.message}`, 'error');
      taskStatusPool[port] = 'stopped';
    } finally {
      scrapeLoading.value = null;
    }
  };

  // 4. 任务实时控制
  const controlScraperTask = async (port, status) => {
    try {
      addLog(port, `[指令] 切换状态为: ${status}`, status === 'stopped' ? 'error' : 'warning');
      const res = await fetch(`http://localhost:3000/window/controlTask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port, status })
      });
      const result = await res.json();
      if (result.code === 200) {
        taskStatusPool[port] = status;
        addLog(port, `[反馈] 已成功切换为 ${status}`, 'success');
      }
    } catch (e) {
      ElMessage.error(`操作指令发送失败: ${e.message}`);
    }
  };

  // 5. 开启跨进程日志监听 (实时同步步骤)
  if (window.electronAPI && window.electronAPI.on) {
    window.electronAPI.on('scraper-log', (data) => {
      const { port, msg, type } = data;
      addLog(port, msg, type);
    });
  }

  return {
    openWindows,
    loadingList,
    scrapeLoading,
    showProgress,
    taskLogsPool,
    taskStatusPool,
    refreshOpenList,
    addLog,
    executeScraperTask,
    controlScraperTask
  };
}
