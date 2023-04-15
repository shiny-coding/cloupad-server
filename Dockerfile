FROM node:latest
WORKDIR /cloupad

RUN git clone https://github.com/shiny-coding/cloupad-server

WORKDIR /cloupad/cloupad-server

RUN npm i
RUN npm run build

CMD ["echo", "Finished"]
