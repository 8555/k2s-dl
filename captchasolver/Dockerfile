FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y libopencv-core406 libopencv-imgproc406 libopencv-imgcodecs406 libopencv-videoio406 libopencv-highgui406 && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/darknet
WORKDIR /app
COPY darknet/ /app/darknet/
COPY package*.json /app
COPY index.js /app
RUN npm i
CMD ["node", "index.js"]
