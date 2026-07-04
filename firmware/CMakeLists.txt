cmake_minimum_required(VERSION 3.16)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(buckshot_roulette_irl_mvp)

spiffs_create_partition_image(web web FLASH_IN_PROJECT)
