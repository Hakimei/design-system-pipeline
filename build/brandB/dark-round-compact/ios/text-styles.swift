/*
 * Do not edit — auto-generated
 * on Sun, 12 Oct 2025, 16:25:41 GMT+7
 * 
 * Brand: brandB
 * Mode: dark
 * Shape: round
 * Density: compact
 */

import SwiftUI

struct TextTitleStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.system(size: CGFloat(22.00), weight: .medium)) // ref: {typography.fontSize.heading} // ref: {typography.fontWeight.heading}
            .lineSpacing(1.3) // ref: {typography.lineHeight.heading}
            .tracking(0)
    }
}

struct TextBodyStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.system(size: CGFloat(16.00), weight: .regular)) // ref: {typography.fontSize.body} // ref: {typography.fontWeight.body}
            .lineSpacing(1.5) // ref: {typography.lineHeight.body}
            .tracking(0)
    }
}
