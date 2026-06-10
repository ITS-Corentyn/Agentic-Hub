import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
    { path: '/repo/:id', name: 'repo', component: () => import('./views/RepoReportView.vue'), props: true },
    { path: '/audit/:id', name: 'audit', component: () => import('./views/AuditLiveView.vue'), props: true },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
