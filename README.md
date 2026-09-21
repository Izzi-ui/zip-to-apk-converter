# ZIP-to-APK Converter

A small web app that accepts a ZIP containing an Android Gradle project, runs `assembleDebug`, and downloads the resulting APK.

## Run locally

Requirements: Node.js 20+, Java 17+, and Gradle (unless the uploaded project includes `gradlew`).

```bash
npm install
npm start
```

Open http://localhost:3000. The server limits uploads to 200 MB, extracted content to 1 GB, and builds to 12 minutes.

## Docker

```bash
docker build -t zip-to-apk .
docker run --rm -p 3000:3000 zip-to-apk
```

## Important

This builds untrusted source code inside the server process. For public deployment, run each build in an isolated disposable container/VM with CPU, memory, network, and filesystem limits. The app only supports Android Gradle projects; arbitrary ZIP files cannot be converted to APKs.
