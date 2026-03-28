#!/bin/bash
# 测试 macOS Vision 框架 OCR

osascript -e '
use framework "Vision"
use framework "AppKit"

set imagePath to "/Users/liuyuxuanyi/tmp/test.png"
set imageFile to current application's NSURL's fileURLWithPath:imagePath
set image to current application's NSImage's alloc()'s initWithContentsOfURL:imageFile

if image is missing value then
    log "Failed to load image"
    return
end if

set cgImage to image's CGImageForProposedRect:(missing value) context:(missing value) hints:(missing value)

set request to current application's VNRecognizeTextRequest's alloc()'s init()
request's setRecognitionLevel:1
request's setRecognitionLanguages:{"zh-Hans", "en-US"}

set handler to current application's VNImageRequestHandler's alloc()'s initWithCGImage:cgImage options:{}
handler's performRequests:{request} |error| (missing value)

set results to request's recognizedTextObservations()
set output to ""
repeat with obs in results
    set textItem to (obs's topCandidates:1)'s firstObject()
    if textItem is not missing value then
        set textString to textItem's string() as text
        set output to output & textString & return
    end if
end repeat

log output
'
