"""sanitize_html / html_to_text drop non-content blocks (BUG_LOG 2026-10-29).

bleach(strip=True) removes a disallowed tag but keeps its contents as text, so
Outlook-on-the-web mail showed `P {margin-top:0;margin-bottom:0;}` at the top of
the ticket description. ``strip_non_content`` removes those blocks first.
"""

from django.test import SimpleTestCase

from apps.itsm_core.services.html import html_to_text, sanitize_html, strip_non_content

# Shape of an Outlook on the web / New Outlook message body (no <!-- --> around the CSS).
OWA_HTML = (
    '<html><head>\r\n<meta http-equiv="Content-Type" content="text/html; charset=utf-8">\r\n'
    '<style type="text/css" style="display:none;"> P {margin-top:0;margin-bottom:0;} </style>\r\n'
    "</head>\r\n<body dir=\"ltr\">\r\n"
    '<div class="elementToProof">Dear Team,</div>\r\n'
    '<div class="elementToProof">Please arrange a laptop.</div>\r\n'
    "</body></html>"
)


class StripNonContentTests(SimpleTestCase):
    def test_owa_style_block_does_not_leak_into_html(self):
        out = sanitize_html(OWA_HTML)
        self.assertNotIn("margin-top", out)
        self.assertTrue(out.startswith('<div class="elementToProof">Dear Team,</div>'), out)

    def test_owa_style_block_does_not_leak_into_text(self):
        out = html_to_text(OWA_HTML)
        self.assertNotIn("margin", out)
        self.assertTrue(out.startswith("Dear Team,"), out)

    def test_head_title_script_xml_template_noscript_dropped_with_contents(self):
        raw = (
            "<head><title>Subject line</title></head>"
            "<script>alert(1)</script><xml><o:OfficeDocumentSettings/>office</xml>"
            "<template>tpl</template><noscript>nos</noscript><p>Body</p>"
        )
        self.assertEqual(sanitize_html(raw), "<p>Body</p>")
        self.assertEqual(html_to_text(raw), "Body")

    def test_style_without_head_and_mixed_case(self):
        self.assertEqual(sanitize_html("<STYLE>td{color:red}</Style ><p>Hi</p>"), "<p>Hi</p>")

    def test_unclosed_style_runs_to_end(self):
        self.assertEqual(sanitize_html("<p>Keep</p><style>p{color:red}"), "<p>Keep</p>")

    def test_word_conditional_comments_still_removed(self):
        raw = "<!--[if gte mso 9]><xml><o:x>1</o:x></xml><![endif]--><p>Hello</p>"
        self.assertEqual(sanitize_html(raw), "<p>Hello</p>")

    def test_lookalike_tags_and_normal_content_untouched(self):
        raw = "<header>Top</header><p>Use {braces} and <b>bold</b></p><table><tr><td>1</td></tr></table>"
        self.assertEqual(strip_non_content(raw), raw)
        self.assertEqual(
            sanitize_html(raw),
            "Top<p>Use {braces} and <b>bold</b></p><table><tbody><tr><td>1</td></tr></tbody></table>",
        )

    def test_empty_inputs(self):
        self.assertEqual(strip_non_content(None), "")
        self.assertEqual(sanitize_html(""), "")
        self.assertEqual(html_to_text(None), "")


class HtmlToPreviewTests(SimpleTestCase):
    """The Modern queue's ticket-number hover card text (2026-11-05c)."""

    def test_blocks_become_lines_and_blank_lines_drop(self):
        from apps.itsm_core.services.html import html_to_preview
        raw = "<p>Hi team,</p><p></p><p>Laptop won't boot.<br>Fan is noisy.</p><ul><li>Model X</li></ul>"
        self.assertEqual(html_to_preview(raw), "Hi team,\nLaptop won't boot.\nFan is noisy.\nModel X")

    def test_entities_are_decoded_and_spaces_collapsed(self):
        from apps.itsm_core.services.html import html_to_preview
        self.assertEqual(html_to_preview("<p>A &amp; B&nbsp;&nbsp; &lt;C&gt;</p>"), "A & B <C>")

    def test_email_css_never_shows(self):
        from apps.itsm_core.services.html import html_to_preview
        raw = "<head><style> P {margin-top:0;} </style></head><div>Please reset my password</div>"
        self.assertEqual(html_to_preview(raw), "Please reset my password")

    def test_long_text_is_cut_on_a_word_with_ellipsis(self):
        from apps.itsm_core.services.html import html_to_preview
        out = html_to_preview("<p>" + "word " * 200 + "</p>")
        self.assertLessEqual(len(out), 301)
        self.assertTrue(out.endswith("word…"))

    def test_plain_text_and_empty(self):
        from apps.itsm_core.services.html import html_to_preview
        self.assertEqual(html_to_preview("line one\n\n  line two  "), "line one\nline two")
        self.assertEqual(html_to_preview(""), "")
        self.assertEqual(html_to_preview(None), "")
