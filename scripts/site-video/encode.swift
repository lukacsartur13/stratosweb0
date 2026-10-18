// =============================================================================
// Turns scripts/site-video/record.cjs's frames into an MP4 (H.264 or HEVC,
// tagged hvc1 so Safari plays it), with AVFoundation — no ffmpeg needed.
//
//   swiftc -O scripts/site-video/encode.swift -o /tmp/encode
//   /tmp/encode <framesDir> <out.mp4> <width> <height> <h264|hevc> <bitsPerSecond> [fps] [fadeSeconds]
//
// The screencast's uneven frames are resampled to a steady 30 fps (each
// output frame is the last capture at or before its time), scaled to the
// size asked for, and the last `fade` seconds (0.8) dissolve into the first
// frame, so the loop on the page has no cut. Keyframes every 2 s; the index
// is written first so playback starts before the file has finished loading.
// =============================================================================
import AVFoundation
import AppKit
import VideoToolbox

let a = CommandLine.arguments
let dir = a[1], out = a[2]
let W = Int(a[3])!, H = Int(a[4])!, codec = a[5], bitrate = Int(a[6])!
let fps = a.count > 7 ? Double(a[7])! : 30
let fade = a.count > 8 ? Double(a[8])! : 0.8

let meta = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: dir + "/frames.json"))) as! [[String: Any]]
let files = meta.map { $0["file"] as! String }, ts = meta.map { $0["t"] as! Double }
let t0 = ts[0], dur = ts[ts.count - 1] - t0
let n = Int((dur * fps).rounded(.down)) + 1

try? FileManager.default.removeItem(atPath: out)
let writer = try! AVAssetWriter(outputURL: URL(fileURLWithPath: out), fileType: .mp4)
writer.shouldOptimizeForNetworkUse = true
var props: [String: Any] = [
  AVVideoAverageBitRateKey: bitrate,
  AVVideoMaxKeyFrameIntervalKey: Int(fps * 2),
  AVVideoExpectedSourceFrameRateKey: Int(fps),
  AVVideoAllowFrameReorderingKey: true,
]
if codec == "h264" {
  props[AVVideoProfileLevelKey] = AVVideoProfileLevelH264HighAutoLevel
  props[AVVideoH264EntropyModeKey] = AVVideoH264EntropyModeCABAC
} else {
  props[AVVideoProfileLevelKey] = kVTProfileLevel_HEVC_Main_AutoLevel as String
}
let settings: [String: Any] = [
  AVVideoCodecKey: codec == "h264" ? AVVideoCodecType.h264 : AVVideoCodecType.hevc,
  AVVideoWidthKey: W, AVVideoHeightKey: H,
  AVVideoCompressionPropertiesKey: props,
  AVVideoColorPropertiesKey: [
    AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
    AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
    AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
  ],
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
  kCVPixelBufferWidthKey as String: W, kCVPixelBufferHeightKey as String: H,
])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

func load(_ f: String) -> CGImage {
  let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: dir + "/" + f) as CFURL, nil)!
  return CGImageSourceCreateImageAtIndex(src, 0, nil)!
}
let first = load(files[0])
var cacheName = "", cacheImg: CGImage? = nil
var j = 0
for k in 0..<n {
  let t = t0 + Double(k) / fps
  while j + 1 < ts.count && ts[j + 1] <= t + 1e-9 { j += 1 }
  if files[j] != cacheName { cacheImg = load(files[j]); cacheName = files[j] }
  var pb: CVPixelBuffer? = nil
  CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pb)
  CVPixelBufferLockBaseAddress(pb!, [])
  let ctx = CGContext(data: CVPixelBufferGetBaseAddress(pb!), width: W, height: H, bitsPerComponent: 8,
                      bytesPerRow: CVPixelBufferGetBytesPerRow(pb!), space: CGColorSpace(name: CGColorSpace.sRGB)!,
                      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
  ctx.interpolationQuality = .high
  let rect = CGRect(x: 0, y: 0, width: W, height: H)
  ctx.draw(cacheImg!, in: rect)
  // The last `fade` seconds dissolve into the first frame, so the loop has no cut.
  let left = Double(n - 1 - k) / fps
  if left < fade {
    let u = 1 - left / fade
    ctx.setAlpha(CGFloat(u * u * (3 - 2 * u)))
    ctx.draw(first, in: rect)
    ctx.setAlpha(1)
  }
  CVPixelBufferUnlockBaseAddress(pb!, [])
  while !input.isReadyForMoreMediaData { usleep(2000) }
  adaptor.append(pb!, withPresentationTime: CMTime(value: CMTimeValue(k), timescale: CMTimeScale(fps)))
}
input.markAsFinished()
let sem = DispatchSemaphore(value: 0)
writer.finishWriting { sem.signal() }
sem.wait()
let size = (try! FileManager.default.attributesOfItem(atPath: out)[.size] as! NSNumber).intValue
print("\(out.split(separator: "/").last!)  \(W)x\(H) \(codec) \(bitrate / 1000) kbps  \(n) frames \(String(format: "%.1f", Double(n) / fps)) s  \(size / 1024) kB  status \(writer.status.rawValue) \(writer.error?.localizedDescription ?? "")")
