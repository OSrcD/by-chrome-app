<template>
  <div class="platform-form glass-card">
    <div class="form-header">
      <el-icon class="platform-icon"><VideoCamera /></el-icon>
      <h4>抖音 / 字节系平台设置</h4>
    </div>
    
    <el-result icon="info" title="功能暂未开放" sub-title="正在适配抖音搜索 API 与 DOM 结构（含同城/时间过滤），敬请期待。">
      <template #extra>
        <el-button type="primary" plain disabled>近期上线</el-button>
      </template>
    </el-result>
  </div>
</template>

<script setup>
import { VideoCamera } from '@element-plus/icons-vue';
</script>

<style scoped>
.glass-card {
  background: rgba(255, 255, 255, 0.4);
  padding: 40px;
  border-radius: 12px;
  border: 1px dashed rgba(64, 158, 255, 0.5);
  margin-bottom: 25px;
  text-align: center;
}
.form-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 15px;
  justify-content: center;
}
.form-header h4 {
  margin: 0;
  font-size: 15px;
  color: #333;
}
.platform-icon {
  color: #1c1c1e; /* 抖音黑 */
}
</style>
