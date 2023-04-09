#!/bin/bash

arch=$1
repo="nexus.coke.fyi"
name="medley/radio"
tag="latest"
git_branch=$(git branch --show-current)
git_rev=$(git rev-parse HEAD | cut -c 1-8)

full_image_name=${repo}/${name}:${tag}

date=$(date +%s)

if [[ -z "${arch}" ]]; then
   echo "Please enter architecture to build [amd64 | arm64]"
   exit
fi

if [[ $PWD == *"/docker"* ]]; then
  echo "Please run this command at project root level"
  echo "e.g.: docker/bin/build.sh [arch]"
  exit
fi

echo "---------------------------------------------------------------"
echo "Building on arch: ${arch}"
echo "Build version: ${git_branch}:${git_rev}"
echo "Build date: $(date)"
echo "Build image: ${full_image_name}"
echo "---------------------------------------------------------------"

docker buildx build -f docker/Dockerfile --platform=linux/"${arch}" --build-arg NODE_ENV=production -t ${full_image_name} .

retVal=$?
if [ $retVal -ne 0 ]; then
    echo "Build error, please see console log for more information."
    exit $retVal
fi

docker push ${full_image_name}
exit $retVal
