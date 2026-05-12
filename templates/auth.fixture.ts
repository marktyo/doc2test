import path from 'node:path';

/**
 * 登录态 storage state 索引。
 *
 * 本文件**不是静态写死的**：阶段 3 会根据 test/.skill-config.yaml 中
 * auth_modes 的 key，动态渲染所有角色对应的导出常量。
 *
 * 例如，若 .skill-config.yaml 中：
 *   auth_modes:
 *     customer: { login_url: /login }
 *     seller:   { login_url: /seller/login }
 *     admin:    { login_url: /admin/login }
 *
 * 则本文件会被渲染为：
 *   export const customerStorageState = path.join(fixturesDir, 'auth-customer.json');
 *   export const sellerStorageState   = path.join(fixturesDir, 'auth-seller.json');
 *   export const adminStorageState    = path.join(fixturesDir, 'auth-admin.json');
 *
 * 命名规则：`{role}StorageState`（lowerCamelCase）。
 *
 * 绝不要把 auth-*.json 提交到仓库 —— 它们包含会话 token。
 * 阶段 3 会自动把 test/playwright/fixtures/auth-*.json 加入 .gitignore。
 */

const fixturesDir = path.resolve(__dirname);

// {{AUTH_EXPORTS_BEGIN}}
// 下面的内容由阶段 3 按 auth_modes 重新生成，请勿手工编辑此区段。
// 默认示例（电商场景）：
export const customerStorageState = path.join(fixturesDir, 'auth-customer.json');
export const sellerStorageState = path.join(fixturesDir, 'auth-seller.json');
export const adminStorageState = path.join(fixturesDir, 'auth-admin.json');
// {{AUTH_EXPORTS_END}}
