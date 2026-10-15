cmake_minimum_required(VERSION 3.16)
project(volt_terminal LANGUAGES CXX)

add_executable(volt_terminal main.cpp)
target_compile_features(volt_terminal PRIVATE cxx_std_17)

if(MSVC)
  target_compile_options(volt_terminal PRIVATE /W4)
else()
  target_compile_options(volt_terminal PRIVATE -Wall -Wextra -Wpedantic)
endif()
