# Tutorly

A journal for private tutors: lesson schedule, payments, homework, reschedules with reasons, and a shared whiteboard. Students and parents get their own accounts and see their lessons, homework and why a lesson was moved.

[Русская версия](README.ru.md) · The app interface is in Russian.

## What's inside

| Part | Folder | What it is |
| --- | --- | --- |
| Desktop app | `main.js`, `renderer/` | Electron app for Linux and Windows, used by the teacher |
| Server | `server/` | Node.js server: accounts, journal sync, shared whiteboard |
| Mobile app | `mobile/` | Expo (React Native) app for iPhone and Android: teacher, student and parent |

## Features

- **Teacher:** weekly schedule, "done" and "paid" marks, reschedule or cancel with a reason, debts and payment reminders, homework with statuses, per-lesson whiteboard.
- **Courses, Classroom-style:** one course is one student. The teacher gives the student and the parent a join code; they register and see the course.
- **Student:** lessons, reschedules with reasons, homework (can mark "done"), requests to move a lesson, the lesson board and boards of past lessons.
- **Parent:** the same view, read-only.
- **Reschedule requests:** a student or parent asks to move a lesson; the teacher accepts with one tap or declines with a reply.
- **Whiteboard:** infinite canvas with Miro-style hotkeys, saved per lesson, real-time collaboration, PNG export.
- **Sync:** teacher data is shared between desktop and phone through the server (last write wins).
- **Works offline on one computer:** the desktop app can run without a server, with data in a single local file.

## Quick start

### 1. Server

Requires Node.js 18 or newer.

```
cd server
npm install
ADMIN_TOKEN=$(openssl rand -base64 24) npm start
```

For a VPS setup (systemd, Caddy, HTTPS), accounts, roles and the admin CLI, see [`server/README.md`](server/README.md) (Russian).

### 2. Desktop app

```
npm install --save-dev electron electron-builder
npm start
```

On Arch Linux, if Electron complains about `chrome-sandbox`: `npx electron . --no-sandbox`.
Build an installer with `npm run dist` (AppImage on Linux, `.exe` on Windows).

On first launch choose a role (student, parent or teacher) and enter the server address, or pick "work only on this computer". To pre-fill the address, set it in `renderer/config.js`.

### 3. Mobile app

See [`mobile/README.md`](mobile/README.md) (Russian). In short:

```
npx create-expo-app@latest tutorly-mobile --template blank
cd tutorly-mobile
npx expo install react-native-webview expo-secure-store expo-crypto
# copy App.js, src/ and app.json from ./mobile, then:
npx expo start
```

## Accounts and security

- Registration by login and password, no email. A forgotten password is reset by the teacher (for students and parents) or by the server admin (`node server/admin.js reset <login>`).
- Passwords are hashed with scrypt, session tokens are stored hashed. Each teacher's data is stored separately.
- Set `TEACHER_INVITE` on the server to restrict who can register as a teacher.
- Parents have read-only access. Notes, prices and contacts are never sent to students or parents.

## Status

A working prototype. The server flows are covered by end-to-end tests run against a real server; the desktop and mobile UIs have not yet been tested on real devices, so expect rough edges.

## License

No license has been chosen yet. All rights reserved by the author until one is added.
