import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {path:'/model-generation',name:'model-generation',component:()=>import('../modules/model-generation/ModelGenerationView.vue')},
    {
      path: '/scene-lighting',
      name: 'scene-lighting',
      component: () => import('../modules/scene-lighting/SceneLightingView.vue'),
    },
    {
      path: '/experiments/umbrella-shadow',
      name: 'umbrella-shadow-experiment',
      component: () => import('../modules/experiments/UmbrellaShadowDemo.vue'),
    },
    {
      path: '/',
      name: 'dashboard',
      component: () => import('../modules/dashboard/DashboardView.vue'),
    },
    {
      path: '/resource-manager',
      name: 'resource-manager',
      component: () => import('../modules/resource-manager/components/ResourceManagerView.vue'),
    },
    {
      path: '/sprite-slicer',
      name: 'sprite-slicer',
      component: () => import('../modules/sprite-slicer/components/SlicerView.vue'),
    },
    {
      path: '/tileset-maker',
      name: 'tileset-maker',
      component: () => import('../modules/tileset-maker/components/TilesetMakerView.vue'),
    },
    {
      path: '/scene-region-editor',
      name: 'scene-region-editor',
      component: () => import('../modules/scene-region-editor/components/SceneRegionEditorView.vue'),
    },
  ],
})

export default router
