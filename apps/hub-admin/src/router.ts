import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/catalog' },
    { path: '/catalog', name: 'catalog', component: () => import('./views/CatalogView.vue') },
    {
      path: '/catalog/:id',
      name: 'capability-detail',
      component: () => import('./views/CapabilityDetailView.vue'),
    },
    { path: '/overview', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
    { path: '/sources', name: 'sources', component: () => import('./views/SourcesView.vue') },
    { path: '/roles', name: 'roles', component: () => import('./views/RolesView.vue') },
    { path: '/manifests', name: 'manifests', component: () => import('./views/ManifestsView.vue') },
    { path: '/audit', name: 'audit', component: () => import('./views/AuditView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/catalog' },
  ],
});
