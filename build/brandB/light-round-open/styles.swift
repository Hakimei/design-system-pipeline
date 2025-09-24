/*
 * Do not edit — auto-generated
 * on Wed, 24 Sept 2025, 16:30:27 GMT+7
 * 
 * Brand: brandB
 * Mode: light
 * Shape: round
 * Density: open
 */

import SwiftUI

struct TextTitleStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.system(size: CGFloat(22.00), weight: .medium))
            .lineSpacing(1.3)
            .tracking(0)
    }
}

struct TextBodyStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.system(size: CGFloat(16.00), weight: .regular))
            .lineSpacing(1.5)
            .tracking(0)
    }
}
