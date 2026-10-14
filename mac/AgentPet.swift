// Agent Pet: a little office character that floats on your Mac's desktop and shows what Agent Office is up to.
// It draws the office's /pet.html page in a see-through, always-on-top window you can drag anywhere.
// Build and run with scripts/pet.sh (needs Xcode's command line tools for swiftc).
import AppKit
import WebKit

private let defaults = UserDefaults.standard

/** Where the office runs: AGENT_OFFICE_URL, else 127.0.0.1 on PORT (default 4321), like the office itself. */
private let officeURL: URL = {
  let env = ProcessInfo.processInfo.environment
  if let text = env["AGENT_OFFICE_URL"], let url = URL(string: text) { return url }
  let port = env["PORT"].flatMap(Int.init) ?? 4321
  return URL(string: "http://127.0.0.1:\(port)/")!
}()

private enum PetSize: String, CaseIterable {
  case small, medium, large
  var points: NSSize {
    switch self {
    case .small: return NSSize(width: 160, height: 192)
    case .medium: return NSSize(width: 200, height: 240)
    case .large: return NSSize(width: 260, height: 312)
    }
  }
  var title: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
}

private let characters = [("worker", "Office worker"), ("dog", "Office dog")]

@main
struct AgentPetMain {
  @MainActor static func main() {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory) // no Dock icon or menu bar: it's just the character
    let pet = Pet()
    app.delegate = pet // a weak reference, so `pet` is kept alive until run() returns
    withExtendedLifetime(pet) { app.run() }
  }
}

/** Sits over the page and takes every click: dragging moves the window, a click opens what the pet points at, right-click shows the menu. */
final class Overlay: NSView {
  weak var pet: Pet?
  private(set) var dragging = false
  private var startMouse: NSPoint?
  private var startOrigin: NSPoint?

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { frame.contains(point) ? self : nil }

  override func mouseDown(with event: NSEvent) {
    if event.modifierFlags.contains(.control) { return rightMouseDown(with: event) }
    startMouse = NSEvent.mouseLocation
    startOrigin = window?.frame.origin
    dragging = false
  }

  override func mouseDragged(with event: NSEvent) {
    guard let start = startMouse, let origin = startOrigin, let window = window else { return }
    let now = NSEvent.mouseLocation
    let dx = now.x - start.x, dy = now.y - start.y
    if !dragging && hypot(dx, dy) < 3 { return }
    dragging = true
    window.setFrameOrigin(NSPoint(x: origin.x + dx, y: origin.y + dy))
  }

  override func mouseUp(with event: NSEvent) {
    if dragging { pet?.moved() } else if startMouse != nil { pet?.clicked() }
    dragging = false
    startMouse = nil
    startOrigin = nil
  }

  override func rightMouseDown(with event: NSEvent) {
    guard let menu = pet?.menu() else { return }
    NSMenu.popUpContextMenu(menu, with: event, for: self)
  }
}

final class Pet: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
  private var window: NSWindow!
  private var web: WKWebView!
  private var overlay: Overlay!
  /** The parts of the window the page says are the pet, top-left origin; empty means all of it. */
  private var hitRects: [NSRect] = []
  private var pointerOver = false
  private var retry: Timer?
  /** Set when the office answered without a pet page (an old build), to say so instead of "not running". */
  private var notBuilt = false

  private var character: String {
    get { defaults.string(forKey: "character") ?? "worker" }
    set { defaults.set(newValue, forKey: "character") }
  }
  private var size: PetSize {
    get { PetSize(rawValue: defaults.string(forKey: "size") ?? "") ?? .medium }
    set { defaults.set(newValue.rawValue, forKey: "size") }
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    let frame = NSRect(origin: .zero, size: size.points)
    window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = false
    window.level = .floating
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
    window.isReleasedWhenClosed = false

    let config = WKWebViewConfiguration()
    config.userContentController.add(self, name: "pet")
    web = WKWebView(frame: frame, configuration: config)
    web.setValue(false, forKey: "drawsBackground") // see-through
    web.navigationDelegate = self
    web.autoresizingMask = [.width, .height]

    overlay = Overlay(frame: frame)
    overlay.autoresizingMask = [.width, .height]
    overlay.pet = self

    let content = NSView(frame: frame)
    content.addSubview(web)
    content.addSubview(overlay)
    window.contentView = content
    window.setFrameOrigin(startingOrigin())
    window.orderFrontRegardless()

    load()
    // Clicks only land on the character and its bubble; anywhere else in the window they go through to what's behind.
    Timer.scheduledTimer(timeInterval: 0.05, target: self, selector: #selector(trackPointer), userInfo: nil, repeats: true)
  }

  /** Where it was left last time if that's still on a screen, else the bottom-right corner of the main screen. */
  private func startingOrigin() -> NSPoint {
    if let saved = defaults.string(forKey: "origin") {
      let origin = NSPointFromString(saved)
      let rect = NSRect(origin: origin, size: size.points)
      if NSScreen.screens.contains(where: { $0.visibleFrame.intersects(rect) }) { return origin }
    }
    let visible = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
    return NSPoint(x: visible.maxX - size.points.width - 24, y: visible.minY + 24)
  }

  private func load() {
    retry?.invalidate()
    notBuilt = false
    var parts = URLComponents(url: officeURL.appendingPathComponent("pet.html"), resolvingAgainstBaseURL: false)!
    parts.queryItems = [URLQueryItem(name: "character", value: character)]
    web.load(URLRequest(url: parts.url!))
  }

  @objc private func reload() { load() }

  private func showOffline(_ message: String) {
    let size = self.size.points
    hitRects = [NSRect(x: 0, y: size.height - 64, width: size.width, height: 64)] // the note at the bottom
    web.loadHTMLString(offlinePage(message), baseURL: nil)
    retry?.invalidate()
    retry = Timer.scheduledTimer(timeInterval: 5, target: self, selector: #selector(reload), userInfo: nil, repeats: false)
  }

  // MARK: the page

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
    if type == "reload" {
      load()
    } else if type == "open", let text = body["url"] as? String, let url = URL(string: text), ["http", "https"].contains(url.scheme ?? "") {
      NSWorkspace.shared.open(url)
    } else if type == "hit", let rects = body["rects"] as? [[String: Any]] {
      hitRects = rects.compactMap { r in
        guard let x = r["x"] as? NSNumber, let y = r["y"] as? NSNumber, let w = r["width"] as? NSNumber, let h = r["height"] as? NSNumber else { return nil }
        return NSRect(x: x.doubleValue, y: y.doubleValue, width: w.doubleValue, height: h.doubleValue)
      }
    }
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    if let http = navigationResponse.response as? HTTPURLResponse, http.statusCode != 200 {
      notBuilt = true
      decisionHandler(.cancel)
      showOffline("Rebuild the office to get the pet: npm run build")
      return
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    failed(error)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    failed(error)
  }

  private func failed(_ error: Error) {
    let nsError = error as NSError
    // 102: the load we cancelled ourselves (see above); NSURLErrorCancelled: replaced by another load.
    if notBuilt || (nsError.domain == "WebKitErrorDomain" && nsError.code == 102) || nsError.code == NSURLErrorCancelled { return }
    showOffline("Agent Office isn't running")
  }

  // MARK: the window

  @objc private func trackPointer() {
    let mouse = NSEvent.mouseLocation, frame = window.frame
    let local = NSPoint(x: mouse.x - frame.minX, y: frame.maxY - mouse.y)
    let over = overlay.dragging || (frame.contains(mouse) && (hitRects.isEmpty || hitRects.contains { $0.contains(local) }))
    if window.ignoresMouseEvents == over { window.ignoresMouseEvents = !over }
    if over != pointerOver {
      pointerOver = over
      web.evaluateJavaScript("window.pet && window.pet.hover && window.pet.hover(\(over))", completionHandler: nil)
    }
  }

  func clicked() {
    web.evaluateJavaScript("window.pet && window.pet.click()", completionHandler: nil)
  }

  func moved() {
    defaults.set(NSStringFromPoint(window.frame.origin), forKey: "origin")
  }

  func menu() -> NSMenu {
    let menu = NSMenu()
    for (key, title) in characters {
      let item = NSMenuItem(title: title, action: #selector(pickCharacter(_:)), keyEquivalent: "")
      item.representedObject = key
      item.state = key == character ? .on : .off
      item.target = self
      menu.addItem(item)
    }
    menu.addItem(.separator())
    let sizes = NSMenu()
    for option in PetSize.allCases {
      let item = NSMenuItem(title: option.title, action: #selector(pickSize(_:)), keyEquivalent: "")
      item.representedObject = option.rawValue
      item.state = option == size ? .on : .off
      item.target = self
      sizes.addItem(item)
    }
    let sizeItem = NSMenuItem(title: "Size", action: nil, keyEquivalent: "")
    sizeItem.submenu = sizes
    menu.addItem(sizeItem)
    menu.addItem(item("Open Agent Office", #selector(openOffice)))
    menu.addItem(item("Reload", #selector(reload)))
    menu.addItem(.separator())
    menu.addItem(item("Quit Agent Pet", #selector(quit)))
    return menu
  }

  private func item(_ title: String, _ action: Selector) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
    item.target = self
    return item
  }

  @objc private func pickCharacter(_ sender: NSMenuItem) {
    guard let key = sender.representedObject as? String, key != character else { return }
    character = key
    load()
  }

  @objc private func pickSize(_ sender: NSMenuItem) {
    guard let raw = sender.representedObject as? String, let picked = PetSize(rawValue: raw) else { return }
    size = picked
    // Grows and shrinks about its bottom middle, so it stays where you put it.
    let old = window.frame, new = picked.points
    window.setFrame(NSRect(x: old.midX - new.width / 2, y: old.minY, width: new.width, height: new.height), display: true)
    moved()
  }

  @objc private func openOffice() { NSWorkspace.shared.open(officeURL) }
  @objc private func quit() { NSApp.terminate(nil) }
}

/** Shown while the office can't be reached: a small grey note at the bottom of the window. */
private func offlinePage(_ message: String) -> String {
  let text = message.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
  return """
  <!doctype html><meta charset="utf-8">
  <style>
    html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
    body { display: flex; align-items: flex-end; justify-content: center; font: 800 12px -apple-system, system-ui, sans-serif; }
    p { margin: 0 8px 12px; padding: 6px 11px; border-radius: 14px; border: 2.5px solid #2A2238; background: #D9D3E6; color: #5B5275; text-align: center; }
  </style>
  <p>💤 \(text)</p>
  <script>window.pet = { click() { webkit.messageHandlers.pet.postMessage({ type: 'reload' }); } };</script>
  """
}
