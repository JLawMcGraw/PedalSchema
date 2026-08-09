-- The "Holy Grail" row is a Holy Grail NEO, and its numbers were wrong.
--
-- EHX sell several different pedals called Holy Grail - the original, plus the
-- Nano, Plus, Neo and Max - at different sizes. This row was seeded as a
-- generic "Holy Grail" measuring 3.5 x 4.7 x 2.1in, which matches none of them.
--
-- It has in practice been a NEO since 2026-08-03, when the head-on photograph
-- was adopted: scraper/mirror-pedal-images.js sources it from
-- ehx.com/wp-content/uploads/2020/10/HolyGrailNeo_-1.jpg and the Neo product
-- page, and the image itself is captioned HOLY GRAIL NEO. So the row already
-- showed a Neo while claiming to be something else, and its jacks could not be
-- read off its own photograph without borrowing another product's layout.
--
-- Naming it settles that. ehx.com/products/holy-grail-neo/ specifies:
--
--     Dimensions (in)   4.5 x 2.75 x 2.1      (EHX list length x width x height)
--     Current Draw      75mA
--     Power Supply      9.6VDC-200mA power adapter included
--
-- against a stored 3.5 x 4.7 x 2.1 at 50mA. Height was already right; width was
-- 0.75in over - three times the Strymon error corrected in 20260808000001 - and
-- depth 0.2in over.
--
-- THE CURRENT DRAW MATTERS MORE THAN THE SIZE. 50mA against a published 75mA is
-- under-reported by half, and it errs in the dangerous direction: a power budget
-- that flatters calls an inadequate supply adequate. The catalogue's stated rule
-- is that draw rounds UP, never down.
--
-- voltage is deliberately LEFT at 9. EHX ship a 9.6VDC adapter, but the pedal
-- runs on the 9V every pedalboard supply provides, and the power panel groups
-- outputs by voltage - recording 9.6 would report a correct 9V output as a
-- mismatch. The adapter figure is in the notes instead.
--
-- Blast radius, measured with the right column names and the error checked this
-- time (see 20260808000001 for why that qualifier is there):
--
--     configuration_pedals rows referencing it:  0
--     pedal_jacks rows:                          0
--
-- On no saved board, so nothing moves. Its jack layout is added separately from
-- the photograph, which is now legitimately its own.

UPDATE pedals
SET name          = 'Holy Grail Neo',
    width_inches  = 2.75,
    depth_inches  = 4.5,
    height_inches = 2.1,
    current_ma    = 75,
    notes = 'Dimensions and current draw quoted from '
         || 'https://www.ehx.com/products/holy-grail-neo/ - "Dimensions (in) '
         || '4.5 x 2.75 x 2.1" (length x width x height) and "Current Draw 75mA". '
         || 'Seeded as a generic "Holy Grail" at 3.5 x 4.7 x 2.1 and 50mA; the '
         || 'width and the draw were both wrong, and the draw was wrong in the '
         || 'flattering direction. EHX include a "9.6VDC-200mA power adapter", '
         || 'but voltage is recorded as 9 because the pedal runs on a standard 9V '
         || 'supply and the power panel groups outputs by voltage.'
WHERE manufacturer = 'Electro-Harmonix' AND name = 'Holy Grail';
