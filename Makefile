install:
	npm install
	npm --prefix frontend install

dev:
	npx tauri dev

check:
	npm test --prefix frontend
	npm run build --prefix frontend

build:
	npx tauri build

web-dev:
	npm --prefix frontend run dev
