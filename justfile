[private]
just:
    just -l

install:
    npm intall

build:
    rm -rf ./dist
    npm run build

shad CMD:
    npx shadcn@latest {{ CMD }}
