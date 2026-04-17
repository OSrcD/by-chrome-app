import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/:pathMatch(.*)', redirect: '/' },
  {
    path: '/',
    name: 'index',
    component: () => import('../view/WindowList.vue'),
    meta: {
      keepAlive: true // 需要缓存的页面
    }
  },
  {
    path: '/proxy',
    name: 'proxy',
    component: () => import('../view/ProxyList.vue'),
    meta: {
      keepAlive: true // 需要缓存的页面
    }
  },
  {
    path: '/sync',
    name: 'sync',
    component: () => import('../view/SyncList.vue'),
    meta: {
      keepAlive: true // 需要缓存的页面
    }
  },
  {
    path: '/newProxy',
    name: 'newproxy',
    component: () => import('../view/NewProxy.vue'),
    meta: {
      keepAlive: false // 不需要缓存的页面
    }
  },
  {
    path: '/editProxy',
    name: 'editproxy',
    component: () => import('../view/EditProxy.vue'),
    meta: {
      keepAlive: false // 不需要缓存的页面
    }
  },
  {
    path: '/editWin',
    name: 'editwin',
    component: () => import('../view/EditWindow.vue'),
    meta: {
      keepAlive: false // 不需要缓存的页面
    }
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../view/Settings.vue'),
    meta: {
      keepAlive: true // 需要缓存的页面
    }
  }
  ,
  {
    path: '/about',
    name: 'about',
    component: () => import('../view/About.vue'),
    meta: {
      keepAlive: true // 需要缓存的页面
    }
  },
  {
    path: '/scraper',
    name: 'scraper',
    component: () => import('../view/Scraper.vue'),
    meta: {
      keepAlive: false
    }
  },
  {
    path: '/testing-center',
    name: 'TestingCenter',
    component: () => import('../view/TestingCenter.vue'),
    meta: {
      keepAlive: false
    }
  },
  {
    path: '/library',
    name: 'ScraperLibrary',
    component: () => import('../view/ScraperLibrary.vue'),
    meta: {
      keepAlive: true // 采集库通常需要缓存
    }
  },
  {
    path: '/video-queue',
    name: 'VideoQueue',
    component: () => import('../view/VideoReproduceTask.vue'),
    meta: {
      keepAlive: true
    }
  }
]
export const router = createRouter({
  history: createWebHashHistory(),
  routes: routes
})

export default router
