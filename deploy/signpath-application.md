# Jingxu SignPath Foundation application draft

- Project name: Jingxu (镜序)
- Public source repository: https://github.com/userzhang12/-
- Default branch: main
- Open-source license for project-owned source and documentation: Apache-2.0
- License: https://github.com/userzhang12/-/blob/main/LICENSE
- Notices and asset scope: https://github.com/userzhang12/-/blob/main/NOTICE
- Website and intended official download location: https://jingxu.shop/
- Description: Electron desktop client and web/API source for producing vertical short-form product dramas. The Windows x64 client connects to a hosted workbench.
- Build system: GitHub Actions (Windows runner) and Electron Builder with an NSIS installer.
- Current workflow: https://github.com/userzhang12/-/actions/workflows/windows-release.yml
- Signing scope requested: Windows x64 Electron app executable, NSIS uninstaller, and installer. Sign the internal binaries before final assembly and generate update hashes after signing.
- Current status: The first signed public release is pending. The current workflow uses an existing certificate-based signing configuration and will need a SignPath integration if approved.
- Applicant to complete: maintainer account and contact email.

Application summary:

Jingxu is an Apache-2.0 project providing a Windows desktop client and source for a short-form video production workbench. We request Windows Authenticode signing for official release binaries built from the public repository. Please confirm project eligibility given that Jingxu branding and sample media are excluded from the source-code license and the official desktop client connects to a hosted workbench. We will configure SignPath for the approved artifact and workflow after onboarding.

## Pre-submission checklist

- SignPath's official application is at https://signpath.org/apply. The terms are at https://signpath.org/terms.
- SignPath lists an existing release in the format to be signed as a requirement. Jingxu has built a private Windows x64 NSIS test installer, but no public Windows release was verified. Do not describe the private artifact as a public release. Provide the public release URL once available, or ask SignPath if it will consider the project before that milestone.
- Configure maintainer MFA and confirm authors, reviewers and signing approvers. Publish the required code-signing policy and a privacy policy that explains the hosted workbench and involved services. Identify SignPath as the certificate provider only once approved.

## 给另一台电脑的 Codex 的提示词

> 请接手镜序（`userzhang12/-`）的 SignPath Foundation 免费 Windows 代码签名申请。先拉取 GitHub 默认分支 `main`，阅读 `deploy/signpath-application.md`、`LICENSE`、`NOTICE` 和 `.github/workflows/windows-release.yml`。用浏览器打开 https://signpath.org/apply 和 https://signpath.org/terms，按最新表单填写项目资料。我授权你提交这份申请。若需要登录、验证邮箱、补填维护者信息或确认条款，让我在浏览器完成。镜序源码已按 Apache-2.0 发布，Windows x64 NSIS 测试包已构建但未签名、也未公开发布。如果必须提供已公开的 Windows 版本链接，请如实询问能否先审核，并把限制告诉我。发布未签名预览版需我另行确认。完成后报告是否已提交、回执或具体卡点。
